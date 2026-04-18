ARGOS RJ - PACOTE COMPLETO PARA RAILWAY

Esse pacote já vem com frontend + backend no mesmo projeto.

ESTRUTURA
- public/ -> páginas do site
- server.js -> backend Express
- package.json -> dependências e start
- railway.json -> configuração de deploy na Railway
- .env.example -> modelo de variáveis

COMO SUBIR NA RAILWAY
1. Extraia TODO o conteúdo deste ZIP.
2. Envie a PASTA INTEIRA do projeto para o GitHub ou faça upload completo.
3. Na Railway, crie um novo projeto a partir desse repositório.
4. Em Variables, preencha os dados do .env.example.
5. O comando de start já está configurado: npm start

IMPORTANTE
- O domínio da Railway só mostra o site se esse projeto completo estiver no deploy.
- Se aparecer "Home of the Railway API", o serviço publicado não é este projeto completo.
- O arquivo de entrada é o server.js na raiz.
- O site público abre em / e as páginas estão dentro de /public.

ROTAS PRINCIPAIS
- / -> home
- /login.html
- /loja.html
- /dashboard.html
- /auth/discord/login
- /api/server/status

OBSERVAÇÃO
Os segredos reais devem ficar no .env, nunca dentro do frontend.