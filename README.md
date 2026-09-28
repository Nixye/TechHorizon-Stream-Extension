# Stage — Discord Stream Activity

Site e Activity para compartilhar uma aba ou janela de aplicativo. A captura acontece em uma aba normal do Chrome/Edge; espectadores assistem no site ou dentro do Discord. Vídeo e áudio seguem por WebRTC diretamente entre o transmissor e cada espectador. O servidor usa WebSocket somente para criar salas e coordenar conexões; não retransmite mídia nem grava a transmissão.

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
4. Inicie a Activity pelo Discord. Ao criar uma sala, você entra nela automaticamente. Clique **Abrir captura com áudio**, depois **Compartilhar aplicativo** na nova aba. Escolha uma **aba ou janela** e ative o áudio dessa fonte quando o navegador oferecer. Não selecione áudio do sistema. A captura da tela inteira é recusada. Compartilhe somente o código da sala com os espectadores. Quem quiser ouvir precisa clicar **Ativar som** na sala. Qualquer participante pode clicar **Modo foco** para ampliar apenas a transmissão; **Sair do foco** ou Esc restaura os controles.

O ID do aplicativo já está configurado. A chave pública informada não é necessária porque a versão atual não recebe interações HTTP do Discord. Nunca inclua o **Client Secret** no frontend.

### Render

O serviço atual `techhorizon-stage-stream` foi criado manualmente no Render a partir do repositório público `Nixye/TechHorizon-Stream-Extension`. O arquivo [`render.yaml`](render.yaml) registra a configuração para futuras recriações. O plano gratuito pode hibernar após 15 minutos sem tráfego; ao reiniciar, as salas em memória são perdidas. Enquanto uma página da sala fica aberta, ela envia sinais periódicos para manter o serviço ativo. Isso não impede reinícios da plataforma ou a suspensão do navegador/dispositivo. O serviço atual foi criado pela opção **Public Git Repository**, que não oferece deploy automático neste fluxo; após mudanças no código, inicie um novo deploy no painel Render. Use um plano pago e persistência compartilhada antes de oferecer serviço público contínuo.

## Limites atuais

- WebRTC usa o STUN público da Cloudflare para descobrir caminhos diretos. Não há TURN configurado; algumas redes restritivas não conseguirão assistir. Um fallback TURN exigiria um relay de mídia, próprio ou contratado.
- O navegador solicita áudio da aba ou janela, com `systemAudio: exclude` e `windowAudio: window`. Esses valores são preferências que o navegador pode ignorar. A captura da tela inteira é recusada, mas uma aplicação web não consegue comprovar que a faixa de áudio de uma janela contém somente o som daquele programa. Abas com áudio são a opção mais confiável. Para isolar de forma garantida o áudio de um jogo ou aplicativo nativo do Windows, será necessário um capturador nativo complementar.
- Cada espectador recebe uma conexão WebRTC direta do transmissor. A velocidade de upload necessária cresce com o número de espectadores; salas grandes precisam de uma arquitetura de distribuição de mídia diferente.
- Até 20 espectadores por sala. A sala permanece válida enquanto houver participantes conectados; quando todos saem, expira após 6 horas sem atividade. Uma página da sala ainda aberta consulta o servidor a cada minuto e renova esse prazo.
- O código da sala dá acesso à visualização. Use apenas com pessoas convidadas. Para uso público, acrescente autenticação Discord e controle de acesso.
- Esta adaptação foi publicada no Render, mas ainda não foi testada em uma sessão real com dois participantes, conforme solicitado. O acesso público à Activity por contas fora da equipe exige a verificação do aplicativo pelo Discord.

## Referências

- [Discord Activities overview](https://docs.discord.com/developers/activities/overview)
- [Discord Embedded App SDK](https://github.com/discord/embedded-app-sdk)
- [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API)
