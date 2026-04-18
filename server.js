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
const appBaseUrl = (req) => process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

app.get('/api/server/status', async (req, res) => {
  try {
    if (process.env.STATUS_API_URL) {
      const response = await fetch(process.env.STATUS_API_URL);
      const data = await response.json();
      return res.json(data);
    }
    return res.json({ online: false, message: 'STATUS_API_URL não configurada', players: { current: 0, max: 0 } });
  } catch {
    return res.status(500).json({ error: 'Falha ao consultar status do servidor.' });
  }
});

app.get('/auth/discord/login', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${appBaseUrl(req)}/auth/discord/callback`;
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
    if (!code) return res.status(400).send('Código do Discord não recebido.');
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || `${appBaseUrl(req)}/auth/discord/callback`;
    if (!clientId || !clientSecret) return res.status(400).send('Configure DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no .env');

    console.log('[Discord Auth] Code recebido:', code);
    console.log('[Discord Auth] Redirect URI:', redirectUri);

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    });
    const tokenData = await tokenRes.json();
    console.log('[Discord Auth] Token response:', tokenRes.status, tokenData);
    if (!tokenRes.ok) return res.status(400).send(`Erro ao obter token: ${JSON.stringify(tokenData)}`);

    const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const me = await meRes.json();
    console.log('[Discord Auth] User data:', meRes.status, me);
    if (!meRes.ok) return res.status(400).send(`Falha ao obter usuário: ${JSON.stringify(me)}`);

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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html><body><script>localStorage.setItem('argos_user', JSON.stringify(${JSON.stringify(payload)}));window.location.href='/dashboard.html';</script></body></html>`);
  } catch (err) {
    console.error('[Discord Auth] Erro:', err);
    res.status(500).send(`Falha ao concluir login: ${err.message}`);
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

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) return res.json({ ok: true, orderId: order.id, message: 'Pedido salvo. Configure MP_ACCESS_TOKEN no .env para gerar o pagamento real.' });

    const preferenceItems = items.map((item) => ({ title: item.name, quantity: 1, unit_price: Number(item.price || 0), currency_id: 'BRL' }));
    if (discount > 0) preferenceItems.push({ title: `Cupom ${coupon.code}`, quantity: 1, unit_price: -Number(discount.toFixed(2)), currency_id: 'BRL' });

    const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ items: preferenceItems, payer: { email }, external_reference: order.id, back_urls: { success: `${appBaseUrl(req)}/checkout.html#resumo-final`, failure: `${appBaseUrl(req)}/checkout.html#pagamento`, pending: `${appBaseUrl(req)}/checkout.html#resumo-final` }, auto_return: 'approved' })
    });
    const prefData = await prefRes.json();
    if (!prefRes.ok) return res.status(400).json({ error: prefData.message || 'Falha ao criar preferência Mercado Pago.', details: prefData });
    res.json({ ok: true, orderId: order.id, init_point: prefData.init_point, sandbox_init_point: prefData.sandbox_init_point });
  } catch {
    res.status(500).json({ error: 'Falha ao criar pagamento.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.listen(PORT, () => console.log(`Argos RJ rodando em http://localhost:${PORT}`));
