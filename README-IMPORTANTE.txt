ARGOS RJ - PACOTE COMPLETO

LOGIN DO DISCORD:
- agora usa login direto no navegador
- não usa CLIENT_SECRET
- não depende do callback do backend para entrar
- no Discord Developer Portal, use este redirect:
  http://argosrj.onrender.com/login.html

O QUE EDITAR:
- public/config.js
  - discord.clientId
  - mercadopago.publicKey
  - links.discordInvite, se quiser trocar

FIREBASE:
- já vem com os dados enviados por você em config.js

MERCADO PAGO:
- a parte visual do checkout está pronta
- deixe a public key em config.js
- a criação real do pagamento no backend continua separada

BACKEND:
- server.js continua no pacote para servir o site e APIs locais
- o login do Discord do site não depende mais do server.js