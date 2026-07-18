// Arquivo de inicialização para hospedagens Node.js (ex.: Hostinger / hPanel).
//
// A Hostinger pré-preenche "app.js" como arquivo de inicialização da aplicação
// Node. Este arquivo apenas sobe o servidor de deploy — todo o motor (casos,
// rubricas, avaliação) vive em deploy/hostinger/. Rode `npm start` para o
// mesmo efeito localmente.

import { iniciar } from "./deploy/hostinger/servidor.js";

iniciar();
