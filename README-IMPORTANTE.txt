Argos RJ v15

O que foi corrigido:
- callback legado /auth/discord/callback.html redireciona para /auth/discord/callback
- login Discord usa rota backend real
- cookies de state adaptam secure para http/https
- data/*.json adicionados para conteúdo auxiliar
- healthcheck em /api/health

Deploy:
1. npm install
2. configure .env
3. npm start

No Discord Developer Portal, use exatamente a mesma URL do DISCORD_REDIRECT_URI.
