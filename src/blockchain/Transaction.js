const { v4: uuidv4 } = require('uuid')

class Transaction {
  constructor({
    personaId,
    institucionId,
    programaId,
    tituloObtenido,
    fechaInicio  = null,   // ← nuevo campo
    fechaFin,
    numeroCedula = null,
    tituloTesis  = null,
    menciones    = null,
    firmadoPor,
  }) {
    this.id             = uuidv4()
    this.personaId      = personaId
    this.institucionId  = institucionId
    this.programaId     = programaId
    this.tituloObtenido = tituloObtenido
    this.fechaInicio    = fechaInicio   // ← nuevo
    this.fechaFin       = fechaFin
    this.numeroCedula   = numeroCedula
    this.tituloTesis    = tituloTesis
    this.menciones      = menciones
    this.firmadoPor     = firmadoPor
    this.creadoEn       = new Date().toISOString()
  }
}

module.exports = Transaction