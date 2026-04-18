IMPORTANTE

1) No Discord Developer Portal, configure o redirect exatamente assim:
https://SEU-DOMINIO.onrender.com/auth/discord/callback

2) No Render, use APP_BASE_URL com https.

3) Se seus segredos já apareceram em prints, gere novos antes de subir.

4) Endpoint útil para teste:
GET /api/health
Ele mostra a base URL e o redirect URI que o servidor está calculando.
