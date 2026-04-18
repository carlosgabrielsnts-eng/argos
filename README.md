IMPORTANTE

1. Este pacote vem com FRONTEND + BACKEND.
2. O Firebase que você mandou já está em public/config.js.
3. Discord e Mercado Pago com segredo real ficam no .env, não no frontend.
4. Para rodar:
   - copie .env.example para .env
   - preencha DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET e MP_ACCESS_TOKEN
   - npm install
   - npm start
5. O cupom ARGOS50 aplica 50% de desconto no checkout.
6. O checkout salva pedido em data/db.json e, quando MP_ACCESS_TOKEN estiver preenchido,
   cria a preferência real do Mercado Pago.
7. O vínculo do ID usa backend local em data/db.json.
