'use strict';
/* Regras de negócio. Nenhum dado de cliente fica neste arquivo. */
const S = { db: null, usuario: '', nome: '', token: '', rota: 'inicio' };
const num = v => Number(v) || 0;
const soma = (l, f) => l.reduce((s, x) => s + num(f ? f(x) : x), 0);
const isoDe = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dataDe = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const hoje = () => isoDe(new Date());
const mais = (s, n) => { const d = dataDe(s); d.setDate(d.getDate() + n); return isoDe(d); };
const entre = (a, b) => Math.round((dataDe(b) - dataDe(a)) / 864e5);
const mesDe = s => String(s).slice(0, 7);
const mesMais = (m, n) => { const d = dataDe(m + '-01'); d.setMonth(d.getMonth() + n); return isoDe(d).slice(0, 7); };
const fimMes = m => mais(mesMais(m, 1) + '-01', -1);
const minDe = h => { const p = String(h).split(':').map(Number); return p[0] * 60 + p[1]; };
const horaDe = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const agoraHora = () => horaDe(new Date().getHours() * 60 + new Date().getMinutes());
const SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const diaSem = s => SEM[dataDe(s).getDay()];
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const cfg = (k, p) => { const x = S.db.Config.find(c => c.ID === k); return x && x.Valor !== '' ? x.Valor : p; };
const cfgN = (k, p) => num(cfg(k, p));
const cliente = id => S.db.Clientes.find(c => c.ID === id);
const pet = id => S.db.Pets.find(p => p.ID === id);
const petsDe = id => S.db.Pets.filter(p => p['ID Cliente'] === id && p.Status !== 'Inativo');
const visitasDe = id => S.db.Atendimentos.filter(a => a['ID Cliente'] === id);
const membro = n => S.db.Equipe.find(e => e.Nome === n);
const parceiro = n => { const m = membro(n); return !!m && m.Papel === 'Parceiro'; };
const ativos = () => S.db.Clientes.filter(c => c.Status === 'Ativo');
const regiaoDe = b => S.db['Regiões'].find(r => semAcento(r.Bairro) === semAcento(b));

const FREQ = { Semanal: 7, Quinzenal: 14, Mensal: 28 };
const VEZES = { Semanal: 4, Quinzenal: 2, Mensal: 1 };
const FAIXAS = ['Em dia', 'Atrasado', 'Em risco', 'Perdido'];
const MOTIVOS = ['Cliente pediu', 'Casa fechada ou sem chave', 'Pet indisposto', 'Trânsito ou atraso', 'Clima', 'Equipe', 'Outro'];
const CATEGORIAS = ['Combustível', 'Impostos (DAS)', 'Manutenção do veículo', 'Seguro e IPVA', 'Telefone e internet', 'Materiais', 'Marketing e brindes', 'Cursos', 'Outros'];

// ---------- receita e comissão ----------
/** Próprio: valor cheio. Parceiro: só o percentual da indicação, congelado na conclusão. */
function receita(a) {
  if (!parceiro(a.Profissional)) return num(a.Valor);
  const m = membro(a.Profissional);
  return num(a.Valor) * (a.Percentual !== '' && a.Percentual !== undefined ? num(a.Percentual) : num(m.Percentual));
}
const concluidos = (de, ate) => S.db.Atendimentos.filter(a => a.Status === 'Concluído' && a.Data >= de && a.Data <= ate);
const doMes = m => concluidos(m + '-01', fimMes(m));
const proprios = l => l.filter(a => !parceiro(a.Profissional));

// ---------- retenção ----------
function retencao(c) {
  const v = visitasDe(c.ID), h = hoje();
  const ult = v.filter(a => a.Status === 'Concluído').map(a => a.Data).sort().pop() || '';
  const prox = v.filter(a => a.Status === 'Agendado' && a.Data >= h).sort((a, b) => (a.Data + a.Hora).localeCompare(b.Data + b.Hora))[0] || null;
  const ciclo = FREQ[c['Frequência']] || 0, dias = ult ? entre(ult, h) : null;
  let faixa;
  if (c.Status !== 'Ativo') faixa = c.Status;
  else if (!ciclo) faixa = 'Avulso';
  else if (dias === null) faixa = 'Sem histórico';
  else if (dias <= ciclo) faixa = 'Em dia';
  else if (dias <= 2 * ciclo) faixa = 'Atrasado';
  else if (dias < 3 * ciclo) faixa = 'Em risco';
  else faixa = 'Perdido';
  return { ult, prox, ciclo, dias, faixa, pendente: !prox && ['Atrasado', 'Em risco', 'Perdido'].includes(faixa) };
}
function precoBase(c) {
  const p = soma(petsDe(c.ID), x => x['Preço']);
  return p || num(c['Valor base']) || cfgN('Valor base padrão', 70);
}
const baseMensal = c => precoBase(c) * (VEZES[c['Frequência']] || 0);
function baseLimpa() { return soma(ativos().filter(c => !parceiro(c.Profissional)), baseMensal); }

function carteira() {
  const l = ativos().map(c => ({ c, r: retencao(c) })), g = {};
  FAIXAS.concat('Sem histórico', 'Avulso').forEach(f => { g[f] = l.filter(x => x.r.faixa === f); });
  const com = soma(FAIXAS, f => g[f].length), fixos = com + g['Sem histórico'].length, h = hoje();
  const antes = new Set(concluidos(mais(h, -180), mais(h, -91)).map(a => a['ID Cliente']));
  const depois = new Set(concluidos(mais(h, -90), h).map(a => a['ID Cliente']));
  const risco = g.Atrasado.concat(g['Em risco']);
  const esperadas = soma(l.filter(x => x.r.ciclo), x => 28 / x.r.ciclo);
  const ids = new Set(l.filter(x => x.r.ciclo).map(x => x.c.ID));
  const feitas = concluidos(mais(h, -27), h).filter(a => ids.has(a['ID Cliente'])).length;
  const marcados = l.filter(x => x.r.ciclo && x.r.prox);
  return {
    l, g, com, fixos, risco, marcados, esperadas, feitas,
    churn: com ? g.Perdido.length / com : null,
    emRisco: com ? g['Em risco'].length / com : null,
    retencao90: antes.size ? [...antes].filter(i => depois.has(i)).length / antes.size : null,
    receitaRisco: soma(risco, x => baseMensal(x.c)),
    proximo: fixos ? marcados.length / fixos : null,
    frequencia: esperadas ? feitas / esperadas : null,
    pendentes: l.filter(x => x.r.pendente).sort((a, b) => b.r.dias / b.r.ciclo - a.r.dias / a.r.ciclo)
  };
}

// ---------- agenda ----------
function expediente() {
  return {
    ini: minDe(cfg('Início do expediente', '08:00')), fim: minDe(cfg('Fim do expediente', '19:00')),
    ai: minDe(cfg('Início do almoço', '12:00')), af: minDe(cfg('Fim do almoço', '13:00')),
    dias: String(cfg('Dias de trabalho', 'Seg,Ter,Qua,Qui,Sex,Sáb')).split(',').map(s => s.trim()),
    desl: cfgN('Deslocamento', 30)
  };
}
const duracao = a => num(a['Duração']) || 60;
const doDia = (d, prof) => S.db.Atendimentos.filter(a => a.Data === d && (!prof || a.Profissional === prof) && ['Agendado', 'Concluído'].includes(a.Status)).sort((a, b) => String(a.Hora).localeCompare(String(b.Hora)));
function conflito(d, hora, dur, prof, ignorar) {
  const i = minDe(hora), f = i + num(dur), desl = expediente().desl;
  let perto = null;
  for (const a of doDia(d, prof)) {
    if (a.ID === ignorar || !a.Hora) continue;
    const ai = minDe(a.Hora), af = ai + duracao(a);
    if (i < af && f > ai) return { tipo: 'choque', a };
    if (i < af + desl && f + desl > ai) perto = { tipo: 'perto', a };
  }
  return perto;
}
/** Até 4 horários, priorizando o mesmo bairro, a região do dia, a data do ciclo e a preferência do cliente. */
function sugestoes(c, dur, prof, ignorar) {
  const e = expediente(), h = hoje(), r = retencao(c), reg = c.Bairro ? regiaoDe(c.Bairro) : null, out = [];
  const ideal = r.ult && r.ciclo ? mais(r.ult, r.ciclo) : h, alvo = ideal < h ? h : ideal, agora = minDe(agoraHora());
  for (let n = 0; n < 21; n++) {
    const d = mais(h, n);
    if (!e.dias.includes(diaSem(d))) continue;
    const vis = doDia(d, prof).filter(a => a.ID !== ignorar);
    let base = -Math.abs(entre(alvo, d)) * 0.4, motivo = d === alvo && r.ciclo ? 'Data do ciclo' : '';
    if (c['Dia preferido'] === diaSem(d)) { base += 2; motivo = 'Dia preferido'; }
    if (reg && String(reg.Dias).split(',').map(s => s.trim()).includes(diaSem(d))) { base += 2; motivo = 'Dia da região'; }
    const bairros = vis.map(a => (cliente(a['ID Cliente']) || {}).Bairro).filter(Boolean);
    if (reg && reg['Região'] && bairros.some(b => (regiaoDe(b) || {})['Região'] === reg['Região'])) { base += 2; motivo = 'Mesma região'; }
    if (c.Bairro && bairros.some(b => semAcento(b) === semAcento(c.Bairro))) { base += 2; motivo = 'Mesmo bairro'; }
    let melhor = null;
    for (let m = e.ini; m + dur <= e.fim; m += 30) {
      if (n === 0 && m <= agora) continue;
      if (m < e.af && m + dur > e.ai) continue;
      const hr = horaDe(m);
      if (conflito(d, hr, dur, prof, ignorar)) continue;
      let p = base;
      if (c['Hora preferida']) p -= Math.abs(minDe(c['Hora preferida']) - m) / 60 * 0.5;
      vis.forEach(a => {
        const viz = cliente(a['ID Cliente']);
        if (a.Hora && viz && c.Bairro && semAcento(viz.Bairro) === semAcento(c.Bairro) && Math.abs(minDe(a.Hora) + duracao(a) + e.desl - m) <= 30) p += 1;
      });
      if (!melhor || p > melhor.p) melhor = { data: d, hora: hr, p, motivo };
    }
    if (melhor) out.push(melhor);
  }
  return out.sort((a, b) => b.p - a.p).slice(0, 4).sort((a, b) => a.data.localeCompare(b.data));
}

// ---------- serviços ----------
const servicosAtivos = tipo => S.db['Serviços'].filter(s => s.Ativo !== 'Não' && (!tipo || s.Tipo === tipo));
const servico = n => S.db['Serviços'].find(s => s['Serviço'] === n);
function servicosDoPet(p) {
  return servicosAtivos('Principal').filter(s => (!s['Espécie'] || !p['Espécie'] || s['Espécie'] === p['Espécie']) && (!s.Porte || !p.Porte || s.Porte === p.Porte));
}
function itens(a) { try { const x = JSON.parse(a.Itens || '[]'); return Array.isArray(x) ? x : []; } catch (e) { return []; } }

// ---------- financeiro ----------
function ocorrencias(r, de, ate) {
  const out = [];
  if (r.Ativa === 'Não' || !r['Início']) return out;
  const fim = r.Fim && r.Fim < ate ? r.Fim : ate;
  if (r.Periodicidade === 'Semanal') {
    for (let d = r['Início']; d <= fim; d = mais(d, 7)) if (d >= de) out.push(d);
  } else {
    const dia = dataDe(r['Início']).getDate(), passo = r.Periodicidade === 'Anual' ? 12 : 1;
    for (let m = mesDe(r['Início']); m + '-01' <= fim; m = mesMais(m, passo)) {
      const ult = dataDe(fimMes(m)).getDate(), d = m + '-' + String(Math.min(dia, ult)).padStart(2, '0');
      if (d >= de && d <= fim && d >= r['Início']) out.push(d);
    }
  }
  return out;
}
/** Contas recorrentes ainda sem lançamento. */
function contas(de, ate) {
  const out = [];
  S.db['Recorrências'].forEach(r => ocorrencias(r, de, ate).forEach(d => {
    if (!S.db['Lançamentos'].some(l => l['ID Recorrência'] === r.ID && l['Referência'] === d))
      out.push({ data: d, desc: r['Descrição'], cat: r.Categoria, valor: num(r.Valor), r });
  }));
  S.db['Lançamentos'].filter(l => l.Status === 'Pendente' && l.Tipo !== 'Entrada' && l.Data >= de && l.Data <= ate)
    .forEach(l => out.push({ data: l.Data, desc: l['Descrição'] || l.Categoria, cat: l.Categoria, valor: num(l.Valor), l }));
  return out.sort((a, b) => a.data.localeCompare(b.data));
}
function resumoMes(m) {
  const at = doMes(m), lan = S.db['Lançamentos'].filter(l => mesDe(l.Data) === m);
  const prop = soma(proprios(at), receita), com = soma(at.filter(a => parceiro(a.Profissional)), receita);
  const outras = soma(lan.filter(l => l.Tipo === 'Entrada'), l => l.Valor), rec = prop + com + outras;
  const desp = lan.filter(l => l.Tipo === 'Despesa'), dt = soma(desp, l => l.Valor), ret = soma(lan.filter(l => l.Tipo === 'Retirada'), l => l.Valor);
  const pa = proprios(at), comValor = pa.filter(a => num(a.Valor) > 0), comPets = comValor.filter(a => num(a['Qtd pets']) > 0), comServ = pa.filter(a => a['Serviços']);
  const minutos = soma(comValor, a => duracao(a) + expediente().desl);
  return {
    at, lan, prop, com, outras, rec, desp, dt, ret, resultado: rec - dt, sobra: rec - dt - ret,
    margem: rec && dt ? (rec - dt) / rec : null,
    visitas: pa.length, pa, ticket: comValor.length ? soma(comValor, a => a.Valor) / comValor.length : null,
    ticketPet: comPets.length ? soma(comPets, a => a.Valor) / soma(comPets, a => a['Qtd pets']) : null,
    adicionais: comServ.length ? comServ.filter(a => num(a['Valor adicionais']) > 0).length / comServ.length : null, comServ,
    hora: minutos ? soma(comValor, a => a.Valor) / (minutos / 60) : null
  };
}
/** Saldo informado, ajustado pelo que entrou e saiu depois da data informada. */
function saldoAtual() {
  const s = cfg('Saldo PJ', ''), d = cfg('Data do saldo', '');
  if (s === '' || !d) return null;
  const h = hoje(), ent = S.db.Atendimentos.filter(a => a.Status === 'Concluído' && a['Recebido em'] > d && a['Recebido em'] <= h);
  const lan = S.db['Lançamentos'].filter(l => l.Status === 'Pago' && l.Data > d && l.Data <= h);
  return num(s) + soma(ent, receita) + soma(lan, l => l.Tipo === 'Entrada' ? num(l.Valor) : -num(l.Valor));
}
const aReceber = () => S.db.Atendimentos.filter(a => a.Status === 'Concluído' && !parceiro(a.Profissional) && a.Pagamento === 'A receber');
const comissoesPendentes = () => S.db.Atendimentos.filter(a => a.Status === 'Concluído' && parceiro(a.Profissional) && a['Comissão'] === 'Pendente');
/** Dia do fechamento da comissão: dia configurado do mês seguinte ao atendimento. */
const diaComissao = d => mesMais(mesDe(d), 1) + '-' + String(Math.min(28, cfgN('Dia da comissão', 5))).padStart(2, '0');

function previsao(dias) {
  const h = hoje(), ate = mais(h, dias), mov = [];
  const ag = S.db.Atendimentos.filter(a => a.Status === 'Agendado' && a.Data >= h && a.Data <= ate);
  ag.forEach(a => { if (!parceiro(a.Profissional)) mov.push({ data: a.Data, valor: num(a.Valor), tipo: 'Atendimentos agendados' }); });
  S.db.Atendimentos.filter(a => parceiro(a.Profissional) && (a.Status === 'Agendado' || a['Comissão'] === 'Pendente')).forEach(a => {
    let d = diaComissao(a.Data); if (d < h) d = h;
    if (d <= ate) mov.push({ data: d, valor: receita(a), tipo: 'Comissões por indicação' });
  });
  aReceber().forEach(a => mov.push({ data: h, valor: num(a.Valor), tipo: 'Valores a receber' }));
  S.db['Lançamentos'].filter(l => l.Tipo === 'Entrada' && l.Status === 'Pendente' && l.Data <= ate).forEach(l => mov.push({ data: l.Data < h ? h : l.Data, valor: num(l.Valor), tipo: 'Outras entradas' }));
  contas(mais(h, -60), ate).forEach(c => mov.push({ data: c.data < h ? h : c.data, valor: -c.valor, tipo: c.cat }));
  const comb = cfgN('Combustível por dia', 70), jaHoje = S.db['Lançamentos'].some(l => l.Categoria === 'Combustível' && l.Data === h);
  [...new Set(proprios(ag).map(a => a.Data))].forEach(d => { if (!(d === h && jaHoje)) mov.push({ data: d, valor: -comb, tipo: 'Combustível (estimado)' }); });
  const s0 = saldoAtual(), serie = [];
  let ac = s0 || 0;
  for (let i = 0; i <= dias; i++) { const d = mais(h, i); ac += soma(mov.filter(m => m.data === d), m => m.valor); serie.push({ data: d, v: ac }); }
  const grupos = {};
  mov.forEach(m => { grupos[m.tipo] = (grupos[m.tipo] || 0) + m.valor; });
  return { mov, serie, grupos, s0, entradas: soma(mov.filter(m => m.valor > 0), m => m.valor), saidas: -soma(mov.filter(m => m.valor < 0), m => m.valor), final: ac, menor: Math.min(...serie.map(x => x.v)) };
}
function saude(m) {
  const r = resumoMes(m), h = hoje(), comb = soma(r.desp.filter(l => l.Categoria === 'Combustível'), l => l.Valor);
  const fixo = soma(S.db['Recorrências'].filter(x => x.Ativa !== 'Não' && x.Periodicidade !== 'Anual'), x => num(x.Valor) * (x.Periodicidade === 'Semanal' ? 52 / 12 : 1)) + soma(S.db['Recorrências'].filter(x => x.Ativa !== 'Não' && x.Periodicidade === 'Anual'), x => num(x.Valor) / 12);
  const combVisita = r.visitas && comb ? comb / r.visitas : null, contrib = r.ticket && combVisita !== null ? r.ticket - combVisita : null;
  const saidas = [1, 2, 3].map(n => { const x = resumoMes(mesMais(mesDe(h), -n)); return x.dt + x.ret; }).filter(v => v > 0);
  const media = saidas.length ? soma(saidas) / saidas.length : fixo, saldo = saldoAtual();
  const ano = m.slice(0, 4), recAno = soma(concluidos(ano + '-01-01', ano + '-12-31'), receita), limite = cfgN('Limite anual MEI', 0);
  return { r, comb, fixo, combVisita, equilibrio: contrib > 0 && fixo ? Math.ceil(fixo / contrib) : null, folego: saldo !== null && media > 0 ? saldo / media : null, saldo, recAno, limite, mei: limite ? recAno / limite : null, pesoDesp: r.rec && r.dt ? r.dt / r.rec : null };
}

// ---------- indicadores de agenda ----------
function indicadoresAgenda(m) {
  const e = expediente(), h = hoje(), fim = fimMes(m) < h ? fimMes(m) : h, todos = S.db.Atendimentos.filter(a => mesDe(a.Data) === m && !parceiro(a.Profissional));
  let dias = 0;
  for (let d = m + '-01'; d <= fim; d = mais(d, 1)) if (e.dias.includes(diaSem(d))) dias++;
  const disp = dias * (e.fim - e.ini - (e.af - e.ai)), feitos = todos.filter(a => a.Status === 'Concluído');
  const decididos = todos.filter(a => a.Status !== 'Agendado'), t = s => decididos.filter(a => a.Status === s);
  const reais = feitos.filter(a => a['Início real'] && a['Fim real'] && minDe(a['Fim real']) > minDe(a['Início real']));
  const porDia = SEM.map(s => ({ n: s, l: feitos.filter(a => diaSem(a.Data) === s) })).filter(x => e.dias.includes(x.n) || x.l.length);
  const b = {};
  feitos.forEach(a => { const k = (cliente(a['ID Cliente']) || {}).Bairro || 'Sem bairro'; (b[k] = b[k] || []).push(a); });
  const mot = {};
  decididos.filter(a => a.Motivo).forEach(a => { (mot[a.Motivo] = mot[a.Motivo] || []).push(a); });
  return {
    feitos, decididos, disp, ocup: disp > 0 ? soma(feitos, duracao) / disp : null,
    canc: t('Cancelado'), rem: t('Remarcado'), aus: t('Ausente'), taxa: x => decididos.length ? x.length / decididos.length : null,
    porDia, porBairro: Object.entries(b).map(([n, l]) => ({ n, l, v: soma(l, a => a.Valor) })).sort((x, y) => y.v - x.v),
    motivos: Object.entries(mot).map(([n, l]) => ({ n, l })).sort((x, y) => y.l.length - x.l.length),
    real: reais.length ? soma(reais, a => minDe(a['Fim real']) - minDe(a['Início real'])) / reais.length : null,
    prevista: reais.length ? soma(reais, duracao) / reais.length : null, reais
  };
}
function indicadoresLeads(m) {
  const l = S.db.Leads.filter(x => mesDe(x.Data) === m), c = l.filter(x => x.Etapa === 'Convertido'), v = l.filter(x => x.Motivo === 'Sem vaga');
  return { l, c, v, conv: l.length ? c.length / l.length : null, perda: l.length ? v.length / l.length : null };
}

// ---------- mensagens ----------
const MODELOS = {
  'Confirmação': 'Olá, {nome}! Confirmamos o atendimento de {pets} em {data}, às {hora}? 🐾',
  'A caminho': 'Olá, {nome}! Estamos a caminho para o atendimento de {pets}. Até já! 🐾',
  'Retorno': 'Olá, {nome}! Já está na hora do próximo banho de {pets}. Qual o melhor dia para você? 🐾',
  'Cobrança': 'Olá, {nome}! Passando para lembrar do atendimento de {data}, no valor de {valor}. Obrigado! 🐾',
  'Aniversário': 'Olá, {nome}! Hoje é dia de festa: feliz aniversário para {pets}! 🎂🐾',
  'Triagem': 'Olá! Para verificar nosso atendimento, informe por favor:\n1. Qual a raça?\n2. Qual a idade?\n3. Qual o seu bairro?'
};
const modelo = k => cfg('Mensagem: ' + k, MODELOS[k]);
const dinheiroTxt = v => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function textoMensagem(k, c, a) {
  const ids = a ? itens(a).map(i => i.p).filter(Boolean) : [], ps = (ids.length ? ids.map(pet).filter(Boolean) : petsDe(c.ID)).map(p => p.Pet);
  const nomes = ps.length > 1 ? ps.slice(0, -1).join(', ') + ' e ' + ps[ps.length - 1] : ps[0] || 'seu pet';
  const v = { nome: String(c.Nome).split(' ')[0], pets: nomes, data: a ? dataDe(a.Data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }) : '', hora: a ? a.Hora : '', valor: a ? dinheiroTxt(a.Valor) : '' };
  return String(modelo(k)).replace(/\{(\w+)\}/g, (m, x) => v[x] !== undefined ? v[x] : m);
}
const enviada = (k, ref) => S.db.Mensagens.some(m => m.Modelo === k && m['Referência'] === ref && m.Status === 'Enviada');
function filaMensagens() {
  const h = hoje(), am = mais(h, 1), out = [], add = (k, c, a, ref) => { if (c && c['Aceita mensagens'] !== 'Não' && !enviada(k, ref)) out.push({ k, c, a, ref }); };
  S.db.Atendimentos.filter(a => a.Status === 'Agendado' && (a.Data === am || a.Data === h) && !(a.Data === h && a.Hora < agoraHora())).forEach(a => add('Confirmação', cliente(a['ID Cliente']), a, a.ID + a.Data + a.Hora));
  carteira().pendentes.forEach(x => add('Retorno', x.c, null, x.c.ID + '-' + x.r.ult + '-' + x.r.faixa));
  aReceber().forEach(a => add('Cobrança', cliente(a['ID Cliente']), a, a.ID + '-' + mesDe(h)));
  S.db.Pets.filter(p => p.Status !== 'Inativo' && p.Nascimento && p.Nascimento.slice(5) === h.slice(5)).forEach(p => add('Aniversário', cliente(p['ID Cliente']), null, p.ID + '-' + h.slice(0, 4)));
  return out;
}
/** Séries recorrentes com menos de 14 dias de agenda pela frente. */
function seriesAcabando() {
  const g = {};
  S.db.Atendimentos.filter(a => a['Série']).forEach(a => { if (!g[a['Série']] || a.Data > g[a['Série']].Data) g[a['Série']] = a; });
  return Object.values(g).filter(a => ['Agendado', 'Concluído'].includes(a.Status) && a.Data <= mais(hoje(), 14) && a.Data >= mais(hoje(), -7) && (cliente(a['ID Cliente']) || {}).Status === 'Ativo');
}
