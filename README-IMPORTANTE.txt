IMPORTANTE

1) Use HTTPS no APP_BASE_URL e no DISCORD_REDIRECT_URI.
2) No Discord Developer Portal, o Redirect URI deve ser EXATAMENTE:
   https://SEU-DOMINIO.onrender.com/auth/discord/callback
3) NUNCA coloque segredo no frontend. DISCORD_CLIENT_SECRET e MP_ACCESS_TOKEN ficam só no .env do Render.
4) Se o login falhar, esta versão mostra o detalhe real na tela e também nos logs do Render.
5) Se você expôs secret ou token em print, gere novos imediatamente.
