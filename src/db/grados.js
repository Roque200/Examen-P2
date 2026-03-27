const supabase = require('./supabase')

async function persistirBloque(bloque, nodeId) {
  const transacciones = bloque.data?.transacciones || []

  if (transacciones.length === 0) {
    console.warn('[DB] Bloque sin transacciones académicas, nada que persistir')
    return
  }

  for (const tx of transacciones) {
    const registro = {
      // id lo genera Supabase automáticamente con gen_random_uuid()
      persona_id:      tx.personaId,
      institucion_id:  tx.institucionId,
      programa_id:     tx.programaId,
      titulo_obtenido: tx.tituloObtenido,
      fecha_inicio:    tx.fechaInicio   || null,
      fecha_fin:       tx.fechaFin,
      numero_cedula:   tx.numeroCedula  || null,
      titulo_tesis:    tx.tituloTesis   || null,
      menciones:       tx.menciones     || null,
      firmado_por:     tx.firmadoPor,
      // Campos blockchain
      hash_actual:     bloque.hashActual,
      hash_anterior:   bloque.hashAnterior,
      nonce:           bloque.nonce,
    }

    const { error } = await supabase.from('grados').insert(registro)

    if (error) {
      console.error('[DB] Error al persistir grado:', error.message)
      throw error
    }
  }

  console.log(`[DB] ${transacciones.length} grado(s) del bloque #${bloque.index} persistidos`)
}

async function cargarCadena() {
  const { data, error } = await supabase
    .from('grados')
    .select('*')
    .order('creado_en', { ascending: true })

  if (error) {
    console.error('[DB] Error al cargar cadena:', error.message)
    return []
  }

  if (data.length === 0) return []

  // Agrupar por hash_actual (cada bloque puede tener varias transacciones)
  const bloquesPorHash = {}
  let indexCounter = 1

  for (const registro of data) {
    const hash = registro.hash_actual
    if (!bloquesPorHash[hash]) {
      bloquesPorHash[hash] = {
        index:        indexCounter++,
        hashActual:   registro.hash_actual,
        hashAnterior: registro.hash_anterior,
        nonce:        registro.nonce,
        timestamp:    new Date(registro.creado_en).getTime(),
        data: {
          minadoPor:     registro.firmado_por,
          transacciones: [],
        },
      }
    }
    bloquesPorHash[hash].data.transacciones.push({
      id:             registro.id,
      personaId:      registro.persona_id,
      institucionId:  registro.institucion_id,
      programaId:     registro.programa_id,
      tituloObtenido: registro.titulo_obtenido,
      fechaInicio:    registro.fecha_inicio,
      fechaFin:       registro.fecha_fin,
      numeroCedula:   registro.numero_cedula,
      tituloTesis:    registro.titulo_tesis,
      menciones:      registro.menciones,
      firmadoPor:     registro.firmado_por,
    })
  }

  const bloquesRestaurados = Object.values(bloquesPorHash)

  // Reconstruir génesis sintético
  const primerBloque = bloquesRestaurados[0]
  const genesisReconstruido = {
    index:        0,
    hashActual:   primerBloque.hashAnterior,
    hashAnterior: '0',
    nonce:        0,
    timestamp:    primerBloque.timestamp - 1,
    data:         { mensaje: 'Bloque Génesis - Red Blockchain Grados Académicos' },
  }

  return [genesisReconstruido, ...bloquesRestaurados]
}

// Peers — tu BD no tiene tabla nodos_red, usamos memoria
// Si quieres persistencia de peers agrega la tabla, o déjalo en memoria:
async function guardarPeer(nodeId, direccion) {
  // Sin tabla nodos_red en tu esquema — peers solo en memoria
  console.log(`[DB] Peer ${direccion} registrado en memoria (sin persistencia)`)
}

async function cargarPeers(nodeId) {
  return [] // Sin tabla nodos_red — se registran manualmente al iniciar
}

async function marcarComoPropagado(hashActual, nodosValidadores = []) {
  // Tu esquema no tiene columna propagado — no hacemos nada
}

module.exports = { persistirBloque, marcarComoPropagado, cargarCadena, guardarPeer, cargarPeers }