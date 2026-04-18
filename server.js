require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ links: {}, orders: [] }, null, 2));

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
const readDb = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const writeDb = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const appBaseUrl = (req) => (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const discordRedirectUri = (req) => (process.env.DISCORD_REDIRECT_URI || `${appBaseUrl(req)}/auth/discord/callback`).replace(/\/$/, '');

async function parseMaybeJson(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.includes('application/json')) {
    try {
      return { raw: text, data: JSON.parse(text) };
    } catch {
      return { raw: text, data: null };
    }
  }
  try {
    return { raw: text, data: JSON.parse(text) };
  } catch {
    return { raw: text, data: null };
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAuthError(res, title, details) {
  res.status(400).send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Erro no login Discord</title>
  <style>
    body{margin:0;font-family:Inter,Arial,sans-serif;background:#0c0f16;color:#f2f4f8;display:grid;place-items:center;min-height:100vh;padding:24px}
    .box{width:min(720px,100%);background:#131927;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    h1{margin:0 0 12px;font-size:28px}.muted{color:#b3bdd1;line-height:1.6}
    pre{white-space:pre-wrap;word-break:break-word;background:#0b1120;border-radius:14px;padding:16px;border:1px solid rgba(255,255,255,.08);color:#ffd6d6}
    a{color:#ff8a3d;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">O Discord respondeu de um jeito que o servidor não conseguiu concluir o login. Veja o detalhe abaixo e confira o <strong>Render Logs</strong>.</p>
    <pre>${escapeHtml(details)}</pre>
    <p class="muted"><a href="/login.html">Voltar para o login</a></p>
  </div>
</body>
</html>`);
}

app.get('/api/server/status', async (req, res) => {
  try {
    if (process.env.STATUS_API_URL) {
      const response = await fetch(process.env.STATUS_API_URL);
      const { data } = await parseMaybeJson(response);
      if (!response.ok) return res.status(502).json({ error: 'Falha ao consultar API de status.' });
      return res.json(data || {});
    }
    return res.json({ online: false, message: 'STATUS_API_URL não configurada', players: { current: 0, max: 0 } });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao consultar status do servidor.', details: error.message });
  }
});

app.get('/auth/discord/login', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = discordRedirectUri(req);
  if (!clientId) return res.status(400).send('Configure DISCORD_CLIENT_ID no .env');
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify email');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('prompt', 'consent');
  res.redirect(url.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return renderAuthError(res, 'Código do Discord não recebido', 'A URL de retorno não trouxe o parâmetro "code".');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = discordRedirectUri(req);

    if (!clientId || !clientSecret) {
      return renderAuthError(res, 'Variáveis do Discord ausentes', 'Configure DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no .env do Render.');
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    const tokenParsed = await parseMaybeJson(tokenRes);
    if (!tokenRes.ok) {
      const details = tokenParsed.data
        ? JSON.stringify(tokenParsed.data, null, 2)
        : `Resposta não JSON do Discord ao trocar token (status ${tokenRes.status}). Primeiros caracteres: ${tokenParsed.raw.slice(0, 500)}`;
      console.error('Discord token error:', details);
      return renderAuthError(res, 'Falha ao trocar code por token', details);
    }

    if (!tokenParsed.data?.access_token) {
      const details = tokenParsed.raw || 'Discord não retornou access_token.';
      console.error('Discord token missing access_token:', details);
      return renderAuthError(res, 'Token do Discord ausente', details);
    }

    const meRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokenParsed.data.access_token}` }
    });
    const meParsed = await parseMaybeJson(meRes);
    if (!meRes.ok) {
      const details = meParsed.data ? JSON.stringify(meParsed.data, null, 2) : meParsed.raw;
      console.error('Discord me error:', details);
      return renderAuthError(res, 'Falha ao obter usuário do Discord', details);
    }

    const me = meParsed.data || {};
    const payload = {
      name: me.global_name || me.username,
      discordUser: me.username,
      discordTag: me.discriminator && me.discriminator !== '0' ? me.discriminator : me.id,
      role: 'Player Argos',
      joined: String(new Date().getFullYear()),
      avatar: me.avatar
        ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=256`
        : ((me.global_name || me.username || 'AR').slice(0, 2).toUpperCase()),
      discordId: me.id,
      email: me.email || '',
      gameLink: { gameId: '', code: '', status: 'idle', confirmed: false, requestedAt: '', confirmedAt: '' }
    };

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html><body><script>localStorage.setItem('argos_user', JSON.stringify(${JSON.stringify(payload)}));window.location.href='/dashboard.html';</script></body></html>`);
  } catch (error) {
    console.error('Discord callback fatal error:', error);
    renderAuthError(res, 'Falha ao concluir login', error.message || 'Erro interno desconhecido.');
  }
});

app.post('/api/game-link/request', (req, res) => {
  const { discordId, discordUser, gameId } = req.body || {};
  if (!discordId || !gameId) return res.status(400).json({ error: 'discordId e gameId são obrigatórios.' });
  const db = readDb();
  const link = {
    discordId,
    discordUser: discordUser || '',
    gameId: String(gameId),
    code: `ARGOS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    status: 'pending',
    confirmed: false,
    requestedAt: new Date().toISOString(),
    confirmedAt: ''
  };
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
    const order = {
      id: `ARG-${Date.now()}`,
      discordId: user.discordId,
      discordUser: user.discordUser,
      gameId: user.gameLink.gameId,
      email,
      items,
      coupon: coupon?.code || null,
      subtotal,
      discount,
      total,
      method: method || 'mercadopago',
      status: 'pending_payment',
      createdAt: new Date().toISOString()
    };
    db.orders.unshift(order);
    writeDb(db);

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      return res.json({ ok: true, orderId: order.id, message: 'Pedido salvo. Configure MP_ACCESS_TOKEN no .env para gerar o pagamento real.' });
    }

    const preferenceItems = items.map((item) => ({
      title: item.name,
      quantity: 1,
      unit_price: Number(item.price || 0),
      currency_id: 'BRL'
    }));
    if (discount > 0) {
      preferenceItems.push({
        title: `Cupom ${coupon.code}`,
        quantity: 1,
        unit_price: -Number(discount.toFixed(2)),
        currency_id: 'BRL'
      });
    }

    const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        items: preferenceItems,
        payer: { email },
        external_reference: order.id,
        back_urls: {
          success: `${appBaseUrl(req)}/checkout.html#resumo-final`,
          failure: `${appBaseUrl(req)}/checkout.html#pagamento`,
          pending: `${appBaseUrl(req)}/checkout.html#resumo-final`
        },
        auto_return: 'approved'
      })
    });

    const prefParsed = await parseMaybeJson(prefRes);
    if (!prefRes.ok) {
      return res.status(400).json({
        error: prefParsed.data?.message || 'Falha ao criar preferência Mercado Pago.',
        details: prefParsed.data || prefParsed.raw
      });
    }

    res.json({
      ok: true,
      orderId: order.id,
      init_point: prefParsed.data?.init_point,
      sandbox_init_point: prefParsed.data?.sandbox_init_point
    });
  } catch (error) {
    console.error('Mercado Pago error:', error);
    res.status(500).json({ error: 'Falha ao criar pagamento.', details: error.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.listen(PORT, () => console.log(`Argos RJ rodando em http://localhost:${PORT}`));
