const Block       = require('./Block')
const Transaction = require('./Transaction')
const crypto      = require('crypto')

const DIFFICULTY   = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')
const PROOF_PREFIX = '0'.repeat(DIFFICULTY)

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers para detectar y validar el formato del compañero
// ─────────────────────────────────────────────────────────────────────────────

function esFormatoCompanero(bloque) {
  return !!(bloque.persona_id || bloque.institucion_id || bloque.titulo_obtenido)
}

function normalizarHash(bloque) {
  return {
    hashAnterior: bloque.hash_anterior || bloque.hashAnterior || bloque.previousHash,
    hashActual:   bloque.hash_actual   || bloque.hashActual   || bloque.hash,
  }
}

function calcularHashCompanero({ persona_id, institucion_id, titulo_obtenido, fecha_fin, hash_anterior, nonce }) {
  const data = `${persona_id}${institucion_id}${titulo_obtenido}${fecha_fin}${hash_anterior}${nonce}`
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Valida una cadena sin importar si es nuestro formato o el del compañero.
 * Para cadenas del compañero usa su fórmula de hash; para las nuestras, la nuestra.
 */
function esValidaCadenaExterna(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return false

  for (let i = 0; i < chain.length; i++) {
    const bloque   = chain[i]
    const anterior = chain[i - 1]

    const { hashAnterior, hashActual } = normalizarHash(bloque)

    if (!hashActual || !hashActual.startsWith(PROOF_PREFIX)) {
      console.warn(`[Validacion externa] PoW inválido en bloque ${i}`)
      return false
    }

    if (esFormatoCompanero(bloque)) {
      // Verificar con la fórmula del compañero
      const hashRecalculado = calcularHashCompanero({
        persona_id:      bloque.persona_id,
        institucion_id:  bloque.institucion_id,
        titulo_obtenido: bloque.titulo_obtenido,
        fecha_fin:       bloque.fecha_fin,
        hash_anterior:   bloque.hash_anterior,
        nonce:           bloque.nonce,
      })
      if (hashRecalculado !== hashActual) {
        console.warn(`[Validacion externa] Hash inválido (fórmula compañero) en bloque ${i}`)
        return false
      }
    } else {
      // Verificar con nuestra fórmula
      const bloqueRecalculado = new Block(
        bloque.index,
        bloque.timestamp,
        bloque.data,
        bloque.hashAnterior,
        bloque.nonce
      )
      if (bloqueRecalculado.hashActual !== hashActual) {
        console.warn(`[Validacion externa] Hash inválido (fórmula propia) en bloque ${i}`)
        return false
      }
    }

    // Verificar encadenamiento (excepto primer bloque)
    if (i > 0) {
      const { hashActual: hashActualAnterior } = normalizarHash(anterior)
      if (hashAnterior !== hashActualAnterior) {
        console.warn(`[Validacion externa] Encadenamiento roto en bloque ${i}`)
        return false
      }
    }
  }

  return true
}

class Blockchain {
  constructor() {
    this.chain = []
    this.transaccionesPendientes = []
    this.nodos = new Set()
  }

  async inicializar() {
    const { cargarCadena, cargarPeers } = require('../db/grados')

    const [bloquesPersistidos, peersPersistidos] = await Promise.all([
      cargarCadena(),
      cargarPeers(process.env.NODE_ID || 'nodo-1'),
    ])

    if (bloquesPersistidos.length > 0) {
      this.chain = bloquesPersistidos
      console.log(`[Blockchain] Cadena restaurada desde Supabase: ${this.chain.length} bloque(s)`)
    } else {
      this._crearBloqueGenesis()
    }

    peersPersistidos.forEach(dir => this.nodos.add(dir))
    if (peersPersistidos.length > 0) {
      console.log(`[Blockchain] ${peersPersistidos.length} peer(s) restaurados desde Supabase`)
    }
  }

  // ─── Bloque génesis ────────────────────────────────────────────────────────

  _crearBloqueGenesis() {
    const genesis = new Block(
      0,
      Date.now(),
      { mensaje: 'Bloque Génesis - Red Blockchain Grados Académicos' },
      '0',
      0
    )
    this.chain.push(genesis)
    console.log(`[Blockchain] Bloque génesis creado: ${genesis.hashActual}`)
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  get ultimoBloque() {
    return this.chain[this.chain.length - 1]
  }

  // ─── Proof of Work ─────────────────────────────────────────────────────────

  proofOfWork(data) {
    const index        = this.chain.length
    const timestamp    = Date.now()
    const hashAnterior = normalizarHash(this.ultimoBloque).hashActual
    let nonce = 0

    console.log(`[PoW] Minando bloque #${index} con dificultad ${DIFFICULTY}...`)

    let bloque = new Block(index, timestamp, data, hashAnterior, nonce)
    while (!bloque.cumpleDificultad(DIFFICULTY)) {
      nonce++
      bloque = new Block(index, timestamp, data, hashAnterior, nonce)
    }

    console.log(`[PoW] Bloque #${index} minado! nonce=${nonce} hash=${bloque.hashActual}`)
    return bloque
  }

  // ─── Minado ────────────────────────────────────────────────────────────────

  async minar(nodeId) {
    if (this.transaccionesPendientes.length === 0) {
      throw new Error('No hay transacciones pendientes para minar')
    }

    const data = {
      transacciones: [...this.transaccionesPendientes],
      minadoPor: nodeId,
    }

    const bloque = this.proofOfWork(data)
    this.chain.push(bloque)
    this.transaccionesPendientes = []

    const { persistirBloque } = require('../db/grados')
    persistirBloque(bloque, nodeId).catch(err =>
      console.error('[Blockchain] Error de persistencia:', err.message)
    )

    return bloque
  }

  // ─── Transacciones ─────────────────────────────────────────────────────────

  agregarTransaccion(datosGrado) {
    const tx = new Transaction(datosGrado)
    this.transaccionesPendientes.push(tx)
    console.log(`[Transaccion] Nueva transacción agregada: ${tx.id}`)
    return tx
  }

  // ─── Validación (cadena propia) ────────────────────────────────────────────

  esValida(chain = this.chain) {
    for (let i = 1; i < chain.length; i++) {
      const actual   = chain[i]
      const anterior = chain[i - 1]

      const bloqueRecalculado = new Block(
        actual.index,
        actual.timestamp,
        actual.data,
        actual.hashAnterior,
        actual.nonce
      )
      if (actual.hashActual !== bloqueRecalculado.hashActual) {
        console.warn(`[Validacion] Hash inválido en bloque #${i}`)
        return false
      }
      if (actual.hashAnterior !== anterior.hashActual) {
        console.warn(`[Validacion] Encadenamiento roto en bloque #${i}`)
        return false
      }
      if (!actual.cumpleDificultad(DIFFICULTY)) {
        console.warn(`[Validacion] PoW inválido en bloque #${i}`)
        return false
      }
    }
    return true
  }

  // ─── Consenso ──────────────────────────────────────────────────────────────

  /**
   * Reemplaza la cadena local si la externa es más larga y válida.
   *
   * Usa esValidaCadenaExterna() en lugar de esValida() para poder aceptar
   * cadenas del compañero (que usan una fórmula de hash diferente).
   */
  reemplazarCadena(cadenaExterna) {
    if (
      cadenaExterna.length > this.chain.length &&
      esValidaCadenaExterna(cadenaExterna)
    ) {
      console.log(`[Consenso] Cadena reemplazada: ${this.chain.length} → ${cadenaExterna.length} bloques`)

      const { persistirBloque } = require('../db/grados')
      const nodeId = process.env.NODE_ID || 'nodo-1'
      const indicesLocales = new Set(this.chain.map(b => b.index))

      cadenaExterna.forEach(bloque => {
        if (!indicesLocales.has(bloque.index) && bloque.data?.transacciones?.length > 0) {
          persistirBloque(bloque, nodeId).catch(err =>
            console.error(`[Consenso] Error al persistir bloque #${bloque.index}:`, err.message)
          )
        }
      })

      this.chain = cadenaExterna
      return true
    }
    return false
  }

  // ─── Nodos ─────────────────────────────────────────────────────────────────

  registrarNodo(direccion) {
    const dir = direccion.replace(/\/$/, '')
    this.nodos.add(dir)
    console.log(`[Red] Nodo registrado: ${dir}. Total nodos: ${this.nodos.size}`)

    const { guardarPeer } = require('../db/grados')
    guardarPeer(process.env.NODE_ID || 'nodo-1', dir)
      .catch(err => console.error('[Blockchain] Error guardando peer:', err.message))
  }

  getNodos() {
    return Array.from(this.nodos)
  }
}

module.exports = Blockchain