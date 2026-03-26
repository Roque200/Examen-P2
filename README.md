# Blockchain Node — Grados Académicos

Red blockchain distribuida para la gestión inmutable de títulos y grados académicos. Cada nodo es autónomo, expone una API REST y se comunica con los demás nodos del equipo para mantener una cadena distribuida con consenso descentralizado.

---

## Tabla de contenidos

- [Descripción general](#descripción-general)
- [Tecnologías utilizadas](#tecnologías-utilizadas)
- [Requisitos previos](#requisitos-previos)
- [Instalación y configuración](#instalación-y-configuración)
- [Variables de entorno](#variables-de-entorno)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Levantar la red local](#levantar-la-red-local)
- [Endpoints disponibles](#endpoints-disponibles)
- [Flujo completo de uso](#flujo-completo-de-uso)
- [Esquema de base de datos](#esquema-de-base-de-datos)
- [Fases del proyecto](#fases-del-proyecto)
- [Conceptos clave](#conceptos-clave)

---

## Descripción general

El sistema simula una red blockchain donde cada integrante del equipo opera un nodo independiente. Los nodos comparten transacciones (grados académicos), minan bloques con Proof of Work, se sincronizan y resuelven conflictos de forma distribuida usando el algoritmo de la cadena válida más larga.

Cada registro en la tabla `grados` actúa como un bloque de la cadena. El hash de cada bloque se calcula con SHA256 sobre sus datos, el hash anterior y el nonce, garantizando la inmutabilidad de la cadena.

---

## Tecnologías utilizadas

| Capa | Tecnología |
|---|---|
| Backend | Node.js 24 + Express |
| Base de datos | Supabase (PostgreSQL) |
| Hashing | SHA256 nativo (`crypto`) |
| Comunicación entre nodos | Axios (HTTP) |
| Documentación | OpenAPI 3.0 + Swagger UI |
| Entorno de desarrollo | WSL2 (Ubuntu) + nodemon |
| Control de versiones | Git + GitHub |

---

## Requisitos previos

- Windows con WSL2 habilitado (Ubuntu recomendado)
- Node.js v24 o superior (instalado via NVM)
- Cuenta en [Supabase](https://supabase.com)
- Git configurado con acceso a GitHub

Verificar el entorno:

```bash
node --version    # v24.x.x
npm --version     # 11.x.x
git --version
```

---

## Instalación y configuración

```bash
# Clonar el repositorio
git clone https://github.com/DoctourDot18Pup/blockchain-node-express.git
cd blockchain-node-express

# Instalar dependencias
npm install

# Crear archivo de variables de entorno
cp .env.example .env
```

Editar `.env` con las credenciales reales de Supabase:

```bash
nano .env
```

---

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `PORT` | Puerto del nodo | `8001` |
| `NODE_ID` | Identificador único del nodo | `nodo-1` |
| `SUPABASE_URL` | URL del proyecto Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Llave pública de Supabase | `eyJ...` |
| `PROOF_OF_WORK_DIFFICULTY` | Ceros requeridos al inicio del hash | `3` |

Archivo `.env.example`:

```env
PORT=8001
NODE_ID=nodo-1
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PROOF_OF_WORK_DIFFICULTY=3
```

---

## Estructura del proyecto

```
blockchain-node-express/
├── src/
│   ├── blockchain/
│   │   ├── Block.js          # Clase bloque con cálculo de hash y validación PoW
│   │   ├── Blockchain.js     # Cadena, minado, consenso e inicialización async
│   │   └── Transaction.js    # Modelo de transacción (grado académico pendiente)
│   ├── routes/
│   │   ├── chain.js          # GET /chain
│   │   ├── mine.js           # POST /mine
│   │   ├── transactions.js   # POST /transactions
│   │   └── nodes.js          # POST /nodes/register, GET /nodes/resolve, etc.
│   ├── middleware/
│   │   └── logger.js         # Logger de requests con colores por status HTTP
│   ├── db/
│   │   ├── supabase.js       # Cliente Supabase
│   │   └── grados.js         # Persistencia de bloques y peers
│   ├── utils/
│   │   └── hash.js           # Función SHA256
│   └── app.js                # Servidor Express con inicialización async
├── swagger.yaml              # Especificación OpenAPI 3.0
├── .env.example              # Plantilla de variables de entorno
├── .gitignore
└── package.json
```

---

## Levantar la red local

Para simular la red completa se levantan múltiples instancias del mismo código en puertos diferentes. Abrir una terminal por nodo:

```bash
# Terminal 1 — Nodo 1
npm run node1   # PORT=8001, NODE_ID=nodo-1

# Terminal 2 — Nodo 2
npm run node2   # PORT=8002, NODE_ID=nodo-2

# Terminal 3 — Nodo 3 (opcional)
npm run node3   # PORT=8003, NODE_ID=nodo-3
```

Al iniciar, cada nodo:
1. Se conecta a Supabase
2. Restaura la cadena persistida (o crea el bloque génesis si es la primera vez)
3. Restaura los peers registrados previamente
4. Levanta el servidor HTTP

Verificar que los nodos están activos:

```bash
curl http://localhost:8001/health | json_pp
curl http://localhost:8002/health | json_pp
```

---

## Endpoints disponibles

La documentación interactiva está disponible en:

```
http://localhost:8001/docs
```

### Resumen de endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Estado del nodo |
| `GET` | `/chain` | Cadena completa de bloques |
| `POST` | `/transactions` | Registrar un nuevo grado académico |
| `POST` | `/mine` | Minar transacciones pendientes |
| `POST` | `/nodes/register` | Registrar peers en la red |
| `GET` | `/nodes` | Listar peers registrados |
| `GET` | `/nodes/resolve` | Algoritmo de consenso |
| `POST` | `/nodes/block` | Recibir bloque propagado por un peer |

---

## Flujo completo de uso

### 1. Registrar los nodos entre sí

```bash
# Registrar nodo-2 en nodo-1
curl -X POST http://localhost:8001/nodes/register \
  -H "Content-Type: application/json" \
  -d '{"nodos": ["http://localhost:8002"]}'

# Registrar nodo-1 en nodo-2
curl -X POST http://localhost:8002/nodes/register \
  -H "Content-Type: application/json" \
  -d '{"nodos": ["http://localhost:8001"]}'
```

### 2. Crear una transacción (grado académico)

```bash
curl -X POST http://localhost:8001/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "personaId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "institucionId": "11111111-1111-1111-1111-111111111111",
    "programaId": "33333333-3333-3333-3333-333333333333",
    "tituloObtenido": "Ingeniero en Sistemas Computacionales",
    "fechaFin": "2024-06-15",
    "numeroCedula": "12345678",
    "firmadoPor": "nodo-1"
  }'
```

La transacción se agrega al nodo-1 y se propaga automáticamente al nodo-2. Verificar en nodo-2:

```bash
curl http://localhost:8002/health | json_pp
# "pendientes": 1
```

### 3. Minar el bloque

```bash
curl -X POST http://localhost:8001/mine | json_pp
```

El nodo ejecuta Proof of Work, genera el bloque, lo agrega a su cadena, lo persiste en Supabase y lo propaga a todos los peers.

### 4. Verificar sincronización

```bash
# Ambos nodos deben tener el mismo último hash
curl http://localhost:8001/chain | json_pp | grep hashActual
curl http://localhost:8002/chain | json_pp | grep hashActual
```

### 5. Resolver conflictos (consenso)

Si dos nodos minan simultáneamente, sus cadenas divergen. Para sincronizarlas:

```bash
curl http://localhost:8001/nodes/resolve | json_pp
curl http://localhost:8002/nodes/resolve | json_pp
```

El nodo con la cadena más corta adopta la del nodo con la cadena válida más larga.

---

## Esquema de base de datos

### Tabla principal — `grados`

Cada registro representa un bloque de la cadena (un grado académico minado).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador único |
| `persona_id` | UUID | Referencia a `personas` |
| `institucion_id` | UUID | Referencia a `instituciones` |
| `programa_id` | UUID | Referencia a `programas` |
| `titulo_obtenido` | VARCHAR | Nombre del título |
| `fecha_fin` | DATE | Fecha de graduación |
| `numero_cedula` | VARCHAR | Cédula profesional |
| `hash_actual` | TEXT | SHA256 del bloque |
| `hash_anterior` | TEXT | Hash del bloque previo |
| `nonce` | INTEGER | Número encontrado por PoW |
| `firmado_por` | VARCHAR | Nodo que firmó la transacción |
| `nodo_origen` | VARCHAR | Nodo que minó el bloque |
| `propagado` | BOOLEAN | Si fue propagado a los peers |
| `validado_por` | TEXT[] | Array de nodos validadores |
| `bloque_index` | INTEGER | Posición en la cadena |

### Tabla de peers — `nodos_red`

Persiste los peers conocidos por cada nodo para sobrevivir reinicios.

| Campo | Tipo | Descripción |
|---|---|---|
| `nodo_origen` | VARCHAR | ID del nodo que registró el peer |
| `direccion` | VARCHAR | URL del peer (ej. `http://localhost:8002`) |
| `activo` | BOOLEAN | Si el peer está activo |

---

## Fases del proyecto

### Fase 1 — Blockchain local con PoW
Implementación de las clases `Block`, `Blockchain` y `Transaction` con Proof of Work. La cadena funciona completamente en memoria. Se verificó creación de transacciones, minado y encadenamiento de hashes.

### Fase 2 — Persistencia en Supabase
Cada bloque minado se persiste en la tabla `grados`. Al reiniciar el nodo, la cadena se restaura desde Supabase reconstruyendo también el bloque génesis de forma sintética a partir del `hash_anterior` del bloque más antiguo.

### Fase 3 — Comunicación inter-nodos
Los nodos se registran entre sí via `POST /nodes/register`. Las transacciones creadas en un nodo se propagan automáticamente a todos los peers usando el header `X-Propagated: true` para evitar bucles infinitos. Los bloques minados también se propagan y los peers los validan antes de aceptarlos.

### Fase 4 — Consenso distribuido
Implementación del algoritmo de cadena válida más larga. Se probó provocando conflictos reales con dos nodos minando simultáneamente. El endpoint `GET /nodes/resolve` consulta las cadenas de todos los peers, valida cada una y adopta la más larga si supera a la local.

---

## Conceptos clave

**Bloque génesis** — Primer bloque de la cadena, con `hashAnterior: "0"`. No contiene transacciones académicas y se reconstruye sintéticamente al restaurar desde Supabase.

**Proof of Work** — Para minar un bloque, el nodo incrementa el `nonce` hasta que el SHA256 del bloque completo comience con N ceros (configurado con `PROOF_OF_WORK_DIFFICULTY`).

**Propagación** — Al recibir una transacción o minar un bloque, el nodo lo reenvía a todos sus peers registrados. El header `X-Propagated: true` evita que un peer reenvíe el mensaje nuevamente.

**Consenso** — Ante cadenas divergentes, todos los nodos adoptan la cadena válida más larga disponible en la red. Una cadena es válida si cada bloque tiene el hash correcto, apunta al hash anterior correcto y cumple la dificultad de PoW.

**Persistencia de peers** — Los peers registrados se guardan en la tabla `nodos_red` de Supabase, por lo que sobreviven reinicios del servidor sin necesidad de volver a registrarlos manualmente.
