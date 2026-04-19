
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ links: {}, orders: [] }, null, 2));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

const readDb = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const writeDb = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

async function fetchCompat(...args) {
  if (typeof fetch === 'function') return fetch(...args);
  const mod = await import('node-fetch');
  return mod.default(...args);
}

function inferBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.get('host')}`.replace(/\/$/, '');
}

function getBaseUrl(req) {
  const raw = String(process.env.APP_BASE_URL || '').trim();
  if (!raw) return inferBaseUrl(req);
  return raw.replace(/\/$/, '');
}

function getRedirectUri(req) {
  const raw = String(process.env.DISCORD_REDIRECT_URI || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return `${getBaseUrl(req)}/auth/discord/callback`;
}

function useSecureCookie(req) {
  const explicit = String(process.env.DISCORD_REDIRECT_URI || process.env.APP_BASE_URL || '').trim();
  if (explicit.startsWith('http://')) return false;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim();
  return proto === 'https';
}

function htmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMessagePage(title, message, extra = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>
body{margin:0;font-family:Inter,Arial,sans-serif;background:#0d0f14;color:#f2f4f8;display:grid;min-height:100vh;place-items:center;padding:24px}
.box{width:min(760px,100%);background:#141925;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
h1{margin:0 0 12px;font-size:28px}p{margin:0 0 10px;color:#c7cfdb;line-height:1.6}.muted{font-size:13px;color:#8d99ae}.code{margin-top:16px;padding:14px;border-radius:14px;background:#0b0f18;border:1px solid rgba(255,255,255,.08);white-space:pre-wrap;word-break:break-word;color:#ffcf99}.btn{display:inline-block;margin-top:16px;padding:12px 16px;border-radius:12px;background:#ff7a18;color:#111;text-decoration:none;font-weight:700}
</style>
</head>
<body><div class="box"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p>${extra}<a class="btn" href="/login.html">Voltar ao login</a></div></body></html>`;
}

async function readJsonSafe(response) {
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { text, json };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    baseUrl: getBaseUrl(req),
    redirectUri: getRedirectUri(req),
    hasClientId: !!String(process.env.DISCORD_CLIENT_ID || '').trim(),
    hasClientSecret: !!String(process.env.DISCORD_CLIENT_SECRET || '').trim(),
    secureCookie: useSecureCookie(req)
  });
});

app.get('/api/server/status', async (req, res) => {
  try {
    if (process.env.STATUS_API_URL) {
      const response = await fetchCompat(process.env.STATUS_API_URL);
      const data = await response.json();
      return res.json(data);
    }
    return res.json({ online: false, message: 'STATUS_API_URL não configurada', players: { current: 0, max: 0 } });
  } catch {
    return res.status(500).json({ error: 'Falha ao consultar status do servidor.' });
  }
});

function buildDiscordAuthorizeUrl(req, state) {
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify email');
  url.searchParams.set('redirect_uri', getRedirectUri(req));
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

app.get('/auth/discord/callback.html', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return res.redirect(302, `/auth/discord/callback${qs ? `?${qs}` : ''}`);
});

app.get(['/auth/discord/login','/auth/discord'], (req, res) => {
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  if (!clientId) return res.status(400).send(renderMessagePage('Configuração ausente', 'Configure DISCORD_CLIENT_ID no ambiente do servidor.'));

  const state = crypto.randomBytes(16).toString('hex');
  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/dashboard.html';
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: useSecureCookie(req), maxAge: 10 * 60 * 1000, path: '/' };
  res.cookie('argos_oauth_state', state, cookieOptions);
  res.cookie('argos_oauth_next', next, cookieOptions);
  return res.redirect(buildDiscordAuthorizeUrl(req, state));
});

app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;
  const errorDescription = req.query.error_description;
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
  const redirectUri = getRedirectUri(req);
  const savedState = req.cookies?.argos_oauth_state;
  const next = req.cookies?.argos_oauth_next || '/dashboard.html';

  if (error) {
    return res.status(400).send(renderMessagePage('Discord recusou o login', errorDescription || error));
  }
  if (!code) {
    return res.status(400).send(renderMessagePage('Código ausente', 'O Discord não retornou o código de autorização.'));
  }
  if (!clientId || !clientSecret) {
    return res.status(400).send(renderMessagePage('Configuração ausente', 'Configure DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no ambiente do servidor.'));
  }
  if (savedState && req.query.state && savedState !== req.query.state) {
    return res.status(400).send(renderMessagePage('State inválido', 'O retorno do Discord não corresponde ao state gerado pelo servidor.'));
  }

  try {
    const tokenRes = await fetchCompat('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'ArgosRJ/1.0'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri
      })
    });

    const tokenParsed = await readJsonSafe(tokenRes);
    if (!tokenRes.ok || !tokenParsed.json?.access_token) {
      const detail = tokenParsed.json ? JSON.stringify(tokenParsed.json) : tokenParsed.text.slice(0, 500);
      return res.status(400).send(renderMessagePage(
        'Falha ao concluir login',
        'O Discord não aceitou a troca do código por token.',
        `<div class="code">${htmlEscape(detail || 'Resposta vazia do Discord.')}</div><div class="muted">redirect_uri usado: ${htmlEscape(redirectUri)}</div>`
      ));
    }

    const meRes = await fetchCompat('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenParsed.json.access_token}`,
        'Accept': 'application/json',
        'User-Agent': 'ArgosRJ/1.0'
      }
    });
    const meParsed = await readJsonSafe(meRes);
    if (!meRes.ok || !meParsed.json?.id) {
      const detail = meParsed.json ? JSON.stringify(meParsed.json) : meParsed.text.slice(0, 500);
      return res.status(400).send(renderMessagePage('Falha ao obter conta Discord', 'O token foi gerado, mas a leitura do perfil falhou.', `<div class="code">${htmlEscape(detail || 'Resposta vazia da API do Discord.')}</div>`));
    }

    const me = meParsed.json;
    const payload = {
      name: me.global_name || me.username,
      discordUser: me.username,
      discordTag: me.discriminator && me.discriminator !== '0' ? me.discriminator : me.id,
      role: 'Player Argos',
      joined: String(new Date().getFullYear()),
      avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=256` : ((me.global_name || me.username || 'AR').slice(0, 2).toUpperCase()),
      discordId: me.id,
      email: me.email || '',
      gameLink: { gameId: '', code: '', status: 'idle', confirmed: false, requestedAt: '', confirmedAt: '' }
    };

    res.clearCookie('argos_oauth_state', { path: '/' });
    res.clearCookie('argos_oauth_next', { path: '/' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrando...</title></head><body><script>localStorage.setItem('argos_user', JSON.stringify(${JSON.stringify(payload)}));window.location.replace(${JSON.stringify(next)});</script></body></html>`);
  } catch (err) {
    console.error('Discord OAuth callback error:', err);
    return res.status(500).send(renderMessagePage('Falha ao concluir login', 'O servidor encontrou um erro durante o login com Discord.', `<div class="code">${htmlEscape(err?.message || 'Erro desconhecido.')}</div>`));
  }
});

app.get('/api/me', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      return res.json({ ok: true, mode: 'frontend-token' });
    }
    return res.status(401).json({ ok: false, message: 'Não autenticado' });
  } catch {
    return res.status(401).json({ ok: false, message: 'Não autenticado' });
  }
});

app.post('/api/game-link/request', (req, res) => {
  const { discordId, discordUser, gameId } = req.body || {};
  if (!discordId || !gameId) return res.status(400).json({ error: 'discordId e gameId são obrigatórios.' });
  const db = readDb();
  const link = { discordId, discordUser: discordUser || '', gameId: String(gameId), code: `ARGOS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, status: 'pending', confirmed: false, requestedAt: new Date().toISOString(), confirmedAt: '' };
  db.links[discordId] = link;
  writeDb(db);
  res.json({ ok: true, link });
});

app.get('/api/game-link/status', (req, res) => {
  const { discordId } = req.query;
  if (!discordId) return res.status(400).json({ error: 'discordId é obrigatório.' });
  const db = readDb();
  const link = db.links[discordId] || { gameId: '', code: '', status: 'idle', confirmed: false, requestedAt: '', confirmedAt: '' };
  res.json({ ok: true, link });
});

app.post('/api/payments/create-preference', async (req, res) => {
  try {
    const { items = [], coupon, email, user, method } = req.body || {};
    if (!user?.discordId) return res.status(400).json({ error: 'Usuário não autenticado.' });
    if (!user?.gameLink?.confirmed) return res.status(400).json({ error: 'ID do jogo ainda não confirmado.' });
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Carrinho vazio.' });

    const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const discount = coupon?.code === 'ARGOS50' ? subtotal * 0.5 : 0;
    const total = Math.max(0, subtotal - discount);
    const db = readDb();
    const order = { id: `ARG-${Date.now()}`, discordId: user.discordId, discordUser: user.discordUser, gameId: user.gameLink.gameId, email, items, coupon: coupon?.code || null, subtotal, discount, total, method: method || 'mercadopago', status: 'pending_payment', createdAt: new Date().toISOString() };
    db.orders.unshift(order); writeDb(db);

    const accessToken = String(process.env.MP_ACCESS_TOKEN || '').trim();
    if (!accessToken) return res.json({ ok: true, orderId: order.id, message: 'Pedido salvo. Configure MP_ACCESS_TOKEN no ambiente para gerar o pagamento real.' });

    const preferenceItems = items.map((item) => ({ title: item.name, quantity: 1, unit_price: Number(item.price || 0), currency_id: 'BRL' }));
    if (discount > 0) preferenceItems.push({ title: `Cupom ${coupon.code}`, quantity: 1, unit_price: -Number(discount.toFixed(2)), currency_id: 'BRL' });

    const prefRes = await fetchCompat('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ items: preferenceItems, payer: { email }, external_reference: order.id, back_urls: { success: `${getBaseUrl(req)}/checkout.html#resumo-final`, failure: `${getBaseUrl(req)}/checkout.html#pagamento`, pending: `${getBaseUrl(req)}/checkout.html#resumo-final` }, auto_return: 'approved' })
    });
    const prefParsed = await readJsonSafe(prefRes);
    if (!prefRes.ok) return res.status(400).json({ error: prefParsed.json?.message || 'Falha ao criar preferência Mercado Pago.', details: prefParsed.json || prefParsed.text });
    res.json({ ok: true, orderId: order.id, init_point: prefParsed.json.init_point, sandbox_init_point: prefParsed.json.sandbox_init_point });
  } catch (err) {
    console.error('Mercado Pago error:', err);
    res.status(500).json({ error: 'Falha ao criar pagamento.' });
  }
});

app.listen(PORT, () => {
  console.log(`Argos RJ online na porta ${PORT}`);
});
