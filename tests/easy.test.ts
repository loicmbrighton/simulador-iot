import { describe, expect, it } from 'vitest';
import { avaliar, estadoInicial, passoAtual, PASSOS, type EasyState } from '../src/game/easy';

const st = (p: Partial<EasyState> = {}): EasyState => ({ ...estadoInicial(), ...p });
const livres = { left: null, right: null };

describe('regras do clique no paciente', () => {
  it('coxim na cabeça inicia a posição olfativa, com qualquer mão', () => {
    expect(avaliar(st(), 'cabeca', 'left', 'coxim')).toEqual({ tipo: 'acao', acao: 'olfativa' });
    expect(avaliar(st(), 'cabeca', 'right', 'coxim')).toEqual({ tipo: 'acao', acao: 'olfativa' });
  });
  it('mão livre na cabeça é só uma dica; outro instrumento na cabeça é erro', () => {
    expect(avaliar(st(), 'cabeca', 'right', null).tipo).toBe('dica');
    expect(avaliar(st(), 'cabeca', 'right', 'tubo').tipo).toBe('erro');
  });
  it('mexer na boca sem coxim e posição olfativa é erro', () => {
    expect(avaliar(st(), 'boca', 'right', null).tipo).toBe('erro');
    expect(avaliar(st(), 'boca', 'left', 'laringoscopio').tipo).toBe('erro');
    expect(avaliar(st(), 'boca', 'right', 'tubo').tipo).toBe('erro');
  });
  it('abrir a boca: mão direita livre; com a esquerda é só uma dica', () => {
    expect(avaliar(st({ olfativa: true }), 'boca', 'right', null)).toEqual({ tipo: 'acao', acao: 'abrirBoca' });
    expect(avaliar(st({ olfativa: true }), 'boca', 'left', null).tipo).toBe('dica');
  });
  it('laringoscópio: erro com a boca fechada ou na mão direita; certo na esquerda com a boca aberta', () => {
    expect(avaliar(st({ olfativa: true }), 'boca', 'left', 'laringoscopio').tipo).toBe('erro');
    expect(avaliar(st({ olfativa: true, bocaAberta: true }), 'boca', 'right', 'laringoscopio').tipo).toBe('erro');
    expect(avaliar(st({ olfativa: true, bocaAberta: true }), 'boca', 'left', 'laringoscopio')).toEqual({ tipo: 'acao', acao: 'laringoscopia' });
  });
  it('outro instrumento na boca antes da laringoscopia é erro', () => {
    expect(avaliar(st({ olfativa: true, bocaAberta: true }), 'boca', 'right', 'tubo').tipo).toBe('erro');
    expect(avaliar(st({ olfativa: true, bocaAberta: true }), 'boca', 'right', 'coxim').tipo).toBe('erro');
  });
});

describe('colinha', () => {
  it('avança na ordem certa', () => {
    expect(passoAtual(st(), livres)).toBe(0);
    expect(passoAtual(st(), { left: null, right: 'coxim' })).toBe(1);
    expect(passoAtual(st({ olfativa: true }), livres)).toBe(2);
    expect(passoAtual(st({ olfativa: true }), { left: 'laringoscopio', right: null })).toBe(3);
    expect(passoAtual(st({ olfativa: true, bocaAberta: true }), { left: 'laringoscopio', right: null })).toBe(4);
    expect(passoAtual(st({ olfativa: true, bocaAberta: true, laringoscopia: true }), livres)).toBe(PASSOS.length);
  });
  it('laringoscópio na mão direita não cumpre o passo', () => {
    expect(passoAtual(st({ olfativa: true }), { left: null, right: 'laringoscopio' })).toBe(2);
  });
});
