# Verificación de Esencia Urbana

## Corrección de la compra

Supabase/PostgREST devuelve `payments` como `null` si el pedido no tiene pago, y como objeto cuando existe un pago en la relación uno-a-uno. La cuenta normaliza esas respuestas antes de renderizarlas. Esto evita la pantalla en blanco al crear pedidos y conserva el método de pago del historial.

## Funciones comprobadas

- Crear pedidos, corregir cantidades y agregar/quitar artículos de pedidos pendientes.
- Recuperar el carrito tras un error de stock, sin mostrar éxito ni perder artículos.
- Confirmar pagos de demostración y mostrar un comprobante descargable.
- Recuperar sesión, pedidos completados y comprobantes tras recargar.
- Cancelar pedidos sin afectar las compras completadas.
- Guardar perfil/dirección y crear pedidos con entrega.
- Mostrar compras frecuentes y guardar reseñas de productos comprados.
- Guardar preferencias y mensajes de soporte.
- Catálogo independiente por negocio en una nueva pestaña.
- Interfaz de compra en móvil, sin desbordamiento horizontal.

## Evidencia

16 pruebas de datos y plantilla aprobadas, incluidas las 12 pruebas PostgreSQL con PGlite cuando se proporciona el archivo externo mediante SUPABASE_SQL_PATH. `npm run test:checkout` ejecuta las pruebas de navegador con un servicio aislado que reproduce las respuestas de Auth/PostgREST; no utiliza cuentas reales ni modifica los datos de Supabase. Compilación de producción aprobada.

La conexión de lectura con el Supabase configurado se comprobó previamente con 17 productos. No se ha ejecutado una compra usando las credenciales de un usuario real en esta revisión: antes de presentar, realizar una compra de demostración con la cuenta del presentador en la versión desplegada.

## Alcance de presentación

Los pagos son de demostración, sin cobros reales ni validación bancaria. Los comprobantes no tienen valor tributario. Los mensajes de soporte se guardan en Supabase; no envían correos automáticamente. La entrega se coordina fuera del sistema.

Las claves locales se guardan en .env.local y no se suben al repositorio. Vercel requiere las variables públicas de Supabase configuradas durante la compilación.

## Panel de proveedores

Tres cuentas de demostración creadas en Supabase y asignadas a sus puestos mediante una migración externa. Comprobado el inicio de sesión y la lectura del panel contra Supabase real: cada cuenta recibe su propio puesto y 17 productos. Las credenciales se entregan por separado, fuera del repositorio. Las direcciones .local son identificadores de demostración, sin recepción de correo.

Funciones: reposiciones/retiros de existencias con motivo, cambios de precio, alertas de stock, pedidos del puesto, preparación/entrega, totales e historial de movimientos. Las operaciones están protegidas mediante membresía del lado de PostgreSQL; el navegador no puede elegir el puesto que administra.

Diez pruebas PostgreSQL adicionales verifican aislamiento, permisos, stock no negativo, idempotencia, concurrencia de precios y preparación de pedidos propios. Prueba de navegador aislada del panel aprobada; prueba de compra de clientes repetida con éxito. Se verifican 27 pruebas de datos y plantillas en total cuando se proporcionan los SQL externos.
