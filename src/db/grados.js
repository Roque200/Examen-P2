const supabase = require('./supabase')

/**
 * Persiste un bloque minado en la tabla grados.
 * Cada transacción dentro del bloque genera un registro individual.
 *
 * @param {Block} bloque - Bloque recién minado
 * @param {string} nodeId - ID del nodo que mina
 */
async function persistirBloque(bloque, nodeId) {
  const transacciones = bloque.data?.transacciones || []

  if (transacciones.length === 0) {
    console.warn('[DB] Bloque sin transacciones académicas, nada que persistir')
    return
  }

  const registros = transacciones.map((tx) => ({
    id:                    tx.id,
    persona_id:            tx.personaId,
    institucion_id:        tx.institucionId,
    programa_id:           tx.programaId,
    titulo_obtenido:       tx.tituloObtenido,
    fecha_fin:             tx.fechaFin,
    numero_cedula:         tx.numeroCedula || null,
    titulo_tesis:          tx.tituloTesis  || null,
    menciones:             tx.menciones    || null,
    firmado_por:           tx.firmadoPor,
    hash_actual:           bloque.hashActual,
    hash_anterior:         bloque.hashAnterior,
    nonce:                 bloque.nonce,
    bloque_index:          bloque.index,
    nodo_origen:           nodeId,
    propagado:             false,
    intentos_propagacion:  0,
    validado_por:          [],
  }))

  const { error } = await supabase.from('grados').insert(registros)

  if (error) {
    console.error('[DB] Error al persistir bloque:', error.message)
    throw error
  }

  console.log(`[DB] ${registros.length} grado(s) del bloque #${bloque.index} persistidos en Supabase`)
}

/**
 * Marca un bloque como propagado exitosamente
 * @param {string} hashActual
 * @param {string[]} nodosValidadores
 */
async function marcarComoPropagado(hashActual, nodosValidadores = []) {
  const { error } = await supabase
    .from('grados')
    .update({
      propagado:    true,
      validado_por: nodosValidadores,
    })
    .eq('hash_actual', hashActual)

  if (error) {
    console.error('[DB] Error al marcar propagación:', error.message)
  }
}

/**
 * Carga todos los bloques desde Supabase para reconstruir la cadena
 * al reiniciar el nodo.
 *
 * @returns {Object[]} Bloques ordenados por índice
 */
async function cargarCadena() {
  const { data, error } = await supabase
    .from('grados')
    .select('*')
    .order('bloque_index', { ascending: true })
    .order('creado_en',    { ascending: true })

  if (error) {
    console.error('[DB] Error al cargar cadena:', error.message)
    return []
  }

  // Agrupar registros por bloque_index para reconstruir bloques
  const bloquesPorIndex = {}
  for (const registro of data) {
    const idx = registro.bloque_index
    if (!bloquesPorIndex[idx]) {
      bloquesPorIndex[idx] = {
        index:        idx,
        hashActual:   registro.hash_actual,
        hashAnterior: registro.hash_anterior,
        nonce:        registro.nonce,
        timestamp:    new Date(registro.creado_en).getTime(),
        data: {
          minadoPor:     registro.nodo_origen,
          transacciones: [],
        },
      }
    }
    bloquesPorIndex[idx].data.transacciones.push({
      id:             registro.id,
      personaId:      registro.persona_id,
      institucionId:  registro.institucion_id,
      programaId:     registro.programa_id,
      tituloObtenido: registro.titulo_obtenido,
      fechaFin:       registro.fecha_fin,
      numeroCedula:   registro.numero_cedula,
      tituloTesis:    registro.titulo_tesis,
      menciones:      registro.menciones,
      firmadoPor:     registro.firmado_por,
    })
  }

  return Object.values(bloquesPorIndex)
}

module.exports = { persistirBloque, marcarComoPropagado, cargarCadena }
