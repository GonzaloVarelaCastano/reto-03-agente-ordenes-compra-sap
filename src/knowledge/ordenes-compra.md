# Conocimiento: órdenes de compra

Una OC se prepara con solicitud, cotización y aprobación. El SAP simulado escribe órdenes idempotentes por `solicitud_id`.

- RC1 proveedor existente y activo: bloqueo.
- RC2 aprobación afirmativa y autorizada: bloqueo.
- RC3 monto dentro del tope del aprobador: bloqueo.
- RC4 subárea perteneciente al centro: bloqueo.
- RC5 cotización ausente o diferencia mayor al 2 %: confirmación.
- RC6 IVA ausente: derivar del proveedor y confirmar.
- RC7 pago ausente: derivar e informar.
- RC8 factura anterior: retroactiva y confirmación.
- RC9 aprobación anterior: confirmación.
- RC10 cantidad por precio vs total con tolerancia ±1: bloqueo.

Una confirmación no cambia importes ni elimina bloqueos. La evidencia es un TXT con SHA-256. La unidad es H si la descripción contiene hora(s); de lo contrario UN.
