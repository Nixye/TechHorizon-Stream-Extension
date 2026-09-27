# Stage — Discord Stream Activity

Site e Activity para compartilhar uma tela, janela ou aplicativo. A captura acontece em uma aba normal do Chrome/Edge; espectadores assistem no site ou dentro do Discord. O servidor repassa quadros JPEG via WebSocket, sem armazenar vídeo.

**Site publicado:** https://techhorizon-stage-stream.onrender.com

**Aplicativo Discord:** `1553857876232241263` — mapeamento raiz configurado e Activity ativada em 27/09/2026.

## Rodar localmente

```powershell
npm install
npm run build
npm start
```

Abra `http://localhost:3001`. Para desenvolvimento com recarga automática, rode `npm run server` e `npm run dev` em terminais separados e abra `http://localhost:5173`.

## Configurar a Activity

1. Publique este servidor em uma origem HTTPS pública com suporte a WebSocket (`wss://`). Um host Node persistente é necessário; hospedagem somente estática não funciona.
2. No [Discord Developer Portal](https://discord.com/developers/applications/1553857876232241263), em **Activities → URL Mappings**, mapeie `/` para a origem HTTPS publicada. Ative **Activities**.
3. Em Render, o servidor usa `RENDER_EXTERNAL_URL` automaticamente para abrir a aba externa de captura no domínio real. Em outra hospedagem, configure `PUBLIC_URL=https://seu-dominio.example` no ambiente do servidor. `VITE_PUBLIC_URL` continua disponível como substituição no build.
4. Inicie a Activity pelo Discord. Crie uma sala, clique **Abrir transmissão**, escolha uma tela/janela na nova aba e compartilhe somente o código da sala com os espectadores.

O ID do aplicativo já está configurado. A chave pública informada não é necessária porque a versão atual não recebe interações HTTP do Discord. Nunca inclua o **Client Secret** no frontend.

### Render

O serviço atual `techhorizon-stage-stream` foi criado manualmente no Render a partir do repositório público `Nixye/TechHorizon-Stream-Extension`. O arquivo [`render.yaml`](render.yaml) registra a configuração para futuras recriações. O plano gratuito pode hibernar após 15 minutos sem tráfego; ao reiniciar, as salas em memória são perdidas. O serviço atual foi criado pela opção **Public Git Repository**, que não oferece deploy automático neste fluxo; após mudanças no código, inicie um novo deploy no painel Render. Use um plano pago e persistência compartilhada antes de oferecer serviço público contínuo.

## Limites atuais

- Vídeo apenas, até 1280×720 e 10 quadros/s. Áudio ainda não é transmitido.
- Até 20 espectadores por sala; salas sem transmissão expiram após 12 horas.
- O código da sala dá acesso à visualização. Use apenas com pessoas convidadas. Para uso público, acrescente autenticação Discord e controle de acesso.
- O fluxo dentro do Discord precisa de validação com a Activity publicada; o build local confirma apenas o site e o servidor.

## Referências

- [Discord Activities overview](https://docs.discord.com/developers/activities/overview)
- [Discord Embedded App SDK](https://github.com/discord/embedded-app-sdk)
- [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API)
