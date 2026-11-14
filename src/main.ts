import './style.css';
import { App } from './app';

const app = new App(document.getElementById('app')!);
// Acesso para testes automatizados (screenshots) e depuração no console.
(window as unknown as { __sim: App }).__sim = app;
