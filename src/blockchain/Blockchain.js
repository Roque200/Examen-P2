const Block       = require('./Block')
const Transaction = require('./Transaction')

const DIFFICULTY = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')

class Blockchain {
  constructor() {
    this.chain                   = []
    this.transaccionesPendientes = []
    this.nodos                   = new Set()
  }

  /**
   * Inicializa la cadena cargando desde Supabase.
   * Si no hay bloques persistidos, crea el génesis.
   * Se debe llamar con await antes de arrancar el servidor.
   */
  async inicializar() {
    const { cargarCadena } = require('../db/grados')
    const bloquesPersistidos = await cargarCadena()

    if (bloquesPersistidos.length > 0) {
      this.chain = bloquesPersistidos
      console.log(`[Blockchain] Cadena restaurada desde Supabase: ${this.chain.length} bloque(s)`)
    } else {
      this._crearBloqueGenesis()
    }
  }

  // ─── Bloque génesis ──────────────────────────────────────────────────────────

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

  // ─── Getters ─────────────────────────────────────────────────────────────────

  get ultimoBloque() {
    return this.chain[this.chain.length - 1]
  }

  // ─── Proof of Work ───────────────────────────────────────────────────────────

  proofOfWork(data) {
    const index        = this.chain.length
    const timestamp    = Date.now()
    const hashAnterior = this.ultimoBloque.hashActual
    let nonce          = 0

    console.log(`[PoW] Minando bloque #${index} con dificultad ${DIFFICULTY}...`)

    let bloque = new Block(index, timestamp, data, hashAnterior, nonce)
    while (!bloque.cumpleDificultad(DIFFICULTY)) {
      nonce++
      bloque = new Block(index, timestamp, data, hashAnterior, nonce)
    }

    console.log(`[PoW] Bloque #${index} minado! nonce=${nonce} hash=${bloque.hashActual}`)
    return bloque
  }

  // ─── Minado ──────────────────────────────────────────────────────────────────

  async minar(nodeId) {
    if (this.transaccionesPendientes.length === 0) {
      throw new Error('No hay transacciones pendientes para minar')
    }

    const data = {
      transacciones: [...this.transaccionesPendientes],
      minadoPor:     nodeId,
    }

    const bloque = this.proofOfWork(data)
    this.chain.push(bloque)
    this.transaccionesPendientes = []

    // Persistir en Supabase de forma no bloqueante
    const { persistirBloque } = require('../db/grados')
    persistirBloque(bloque, nodeId).catch(err =>
      console.error('[Blockchain] Error de persistencia:', err.message)
    )

    return bloque
  }

  // ─── Transacciones ───────────────────────────────────────────────────────────

  agregarTransaccion(datosGrado) {
    const tx = new Transaction(datosGrado)
    this.transaccionesPendientes.push(tx)
    console.log(`[Transaccion] Nueva transacción agregada: ${tx.id}`)
    return tx
  }

  // ─── Validación ──────────────────────────────────────────────────────────────

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

  // ─── Consenso ────────────────────────────────────────────────────────────────

  reemplazarCadena(cadenaExterna) {
    if (cadenaExterna.length > this.chain.length && this.esValida(cadenaExterna)) {
      console.log(`[Consenso] Cadena reemplazada: ${this.chain.length} → ${cadenaExterna.length} bloques`)
      this.chain = cadenaExterna
      return true
    }
    return false
  }

  // ─── Nodos ───────────────────────────────────────────────────────────────────

  registrarNodo(direccion) {
    this.nodos.add(direccion.replace(/\/$/, ''))
    console.log(`[Red] Nodo registrado: ${direccion}. Total nodos: ${this.nodos.size}`)
  }

  getNodos() {
    return Array.from(this.nodos)
  }
}

module.exports = Blockchain
