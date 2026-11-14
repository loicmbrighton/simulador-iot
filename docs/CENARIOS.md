# Cenários do simulador

O usuário escolhe um dos três cenários no menu, antes de começar. Nos três, o paciente é um
**adulto com anatomia normal**: sem preditores de via aérea difícil (Mallampati I–II, distância
tireomentoniana ≥ 6 cm, abertura bucal ≥ 3 dedos, pescoço com mobilidade normal, IMC normal).
Exceções anatômicas, como pescoço curto e grosso, obesidade ou trauma cervical, **estão fora do escopo**.

> Este documento é a referência clínica do simulador. **Toda conduta precisa da validação do
> usuário (médico).** Os pontos marcados com ⚙️ são controversos na literatura e ficam
> configuráveis no código.

## Diretrizes escolhidas

| Tema | Referência |
|---|---|
| Sequência rápida na emergência ("7 Ps") | *Walls Manual of Emergency Airway Management* (Brown, Sakles, Mick), 5ª/6ª ed. |
| Intubação eletiva em centro cirúrgico | Difficult Airway Society (DAS) 2015, plano A; monitorização mínima do *ASA Standards for Basic Anesthetic Monitoring* |
| Intubação difícil não prevista / via aérea falha | DAS 2015 (planos A→B→C→D) |
| Ventilação com bolsa-válvula-máscara durante a sequência rápida | Ensaio PreVent (Casey et al., NEJM 2019): ventilação suave permitida |

## Peso clínico dos erros

| Nível | Exemplos | SRI / Eletiva | Easy |
|---|---|---|---|
| **Crítico** | Intubação esofágica não reconhecida; SpO₂ < 70% por demora; laringoscopia sem bloqueio neuromuscular | Mensagem + reprovação no debriefing | Só uma dica neutra ("o tubo parece não estar na traqueia") |
| **Maior** | Alavanca nos dentes com trauma; > 3 tentativas; cuff não insuflado; pular a confirmação por capnografia | Mensagem + desconto na nota | Silencioso |
| **Menor** | Ordem subótima no preparo; pressão do cuff fora de 20–30 cmH₂O; demora moderada | Registrado só no debriefing | Silencioso |

---

## 1. Sequência Rápida (SRI): sala de emergência

**Caso-base:** homem, 40 anos, 75 kg, 1,75 m, intoxicação exógena com Glasgow 7. **Estômago cheio
presumido**, hemodinâmica estável (PA 120×75, FC 95, SpO₂ 94% em ar ambiente). Coluna cervical livre.

### Etapas esperadas (7 Ps)
1. **Preparação** (SOAP-ME): aspirador ligado (Yankauer); O₂ disponível; laringoscópio montado e
   com luz testada (lâmina Macintosh 3 ou 4); tubo 7,5–8,0 com cuff testado (seringa de 10 mL),
   fio-guia em "taco de hóquei" e lubrificado; bougie e máscara laríngea de resgate na bandeja;
   monitor com SpO₂, PA, ECG e capnografia; acesso venoso.
2. **Pré-oxigenação:** 3 min de máscara não reinalante a 15 L/min (ou BVM com boa vedação) +
   **cateter nasal a 15 L/min mantido durante a apneia** (oxigenação apneica). Cabeceira elevada
   20–30° quando possível.
3. **Pré-tratamento:** opcional, não cobrado.
4. **Paralisia com indução** (bólus em sequência, sem titulação):
   - Indutor: **etomidato 0,3 mg/kg** (≈ 22 mg) ou **cetamina 1,5 mg/kg** (≈ 110 mg).
     Propofol 1,5 mg/kg é aceito, com risco de hipotensão simulado.
   - Bloqueador: **succinilcolina 1,5 mg/kg** (≈ 110 mg; fasciculações, início em 45–60 s) ou
     **rocurônio 1,2 mg/kg** (≈ 90 mg; início em ≈ 60 s).
5. **Posicionamento e proteção:** posição olfativa (coxim occipital, alinhamento meato acústico
   externo–fúrcula esternal). ⚙️ Pressão cricoide: **não exigida** e não penalizada.
   ⚙️ Ventilação com BVM durante a apneia: **permitida se suave** (baixa pressão, ≈ 10 mL/kg, 10/min).
6. **Posicionamento do tubo com confirmação:** laringoscopia só após o relaxamento completo;
   tubo passando as cordas sob visão direta; marca de 21–23 cm na arcada; retirar o fio-guia;
   insuflar o cuff. **Confirmação obrigatória por capnografia com curva sustentada (≥ 5 ciclos)**,
   mais ausculta (epigástrio, depois bases e ápices bilaterais) e expansão torácica.
7. **Pós-intubação:** fixar o tubo e registrar a profundidade; cuff em 20–30 cmH₂O
   (cuffômetro); sedoanalgesia contínua (ex.: fentanil + midazolam ou propofol); ventilador
   inicial (VC 6–8 mL/kg do peso predito, PEEP 5, FiO₂ 100% com titulação depois); pedir
   radiografia de tórax.

### Regras do cenário
- Fisiologia ativa: a SpO₂ cai durante a apneia com velocidade dependente da qualidade da pré-oxigenação.
- Tentativa = lâmina entra e sai da boca. Após cada tentativa falha, reoxigenar.
  Após 3 tentativas, o fluxograma de via aérea falha da DAS é oferecido (máscara laríngea).

## 2. Eletiva: centro cirúrgico

**Caso-base:** mulher, 35 anos, 65 kg, 1,65 m, ASA I, colecistectomia videolaparoscópica.
**Jejum adequado** (8 h para sólidos, 2 h para líquidos claros). Anatomia normal.

### Etapas esperadas
1. **Checagem:** equipamento como na SRI; monitorização ASA (ECG, SpO₂, PA não invasiva,
   capnografia; temperatura disponível); acesso venoso.
2. **Posicionamento** em posição olfativa antes da indução.
3. **Pré-oxigenação** com máscara facial bem vedada, O₂ a 100%, por 3 min ou até **FeO₂ ≥ 0,8–0,9**.
4. **Indução titulada:** fentanil 2–3 µg/kg (≈ 150 µg) → propofol 2 mg/kg (≈ 130 mg) → perda da
   consciência (sem reflexo palpebral).
5. **Ventilação sob máscara** (técnica C-E, Guedel se necessário): **esperada e cobrada**.
   Confirmar que é possível ventilar.
6. **Bloqueio neuromuscular:** rocurônio 0,6 mg/kg (≈ 40 mg); continuar ventilando sob máscara
   por cerca de 90–120 s até o relaxamento completo.
7. **Laringoscopia e intubação** (tubo 7,0 para mulher), com confirmação, fixação e cuff como na SRI.
8. **Ventilação mecânica** e manutenção anestésica (fora do escopo detalhado).

### Diferenças-chave em relação à SRI
| | SRI | Eletiva |
|---|---|---|
| Estômago | Cheio | Jejum |
| Drogas | Bólus rápido, doses fixas por peso | Indução titulada |
| BVM antes da laringoscopia | Só se necessário (suave) | **Esperada** |
| Ordem | Indutor + bloqueador juntos | Indutor → ventilar → bloqueador |
| Tempo até laringoscopia | ≈ 45–60 s | ≈ 2–3 min |

## 3. Modo Easy

Treino só da **mecânica** da intubação.
- **Sem fármacos e sem fisiologia punitiva:** a SpO₂ fica estável (ou cai muito devagar, só
  como indicador visual).
- **Paciente já preparado:** anestesiado e relaxado, monitor ligado, material conferido.
- **Sequência treinada:**
  1. Montar o laringoscópio (encaixar a lâmina e verificar a luz)
  2. Posicionar a cabeça (posição olfativa)
  3. Abrir a boca (técnica em tesoura)
  4. Laringoscopia: inserir pela direita, rebater a língua, ponta na valécula, levantar no eixo do cabo
  5. Passar o tubo pelas cordas
  6. Retirar o fio-guia e insuflar o cuff
  7. Conectar o AMBU e ventilar
  8. Confirmar (capnografia e ausculta)
- **Sem mensagens de erro para deslizes leves.** Erros críticos geram só dicas neutras, e o
  usuário pode tentar de novo sem reiniciar.
- **Guia visual opcional:** o próximo passo fica destacado; pode ser desligado.
- Sem nota final; mostra só tempo e número de tentativas.
