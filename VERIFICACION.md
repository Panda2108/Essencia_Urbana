# Verificación de entrega

- 12 pruebas de PostgreSQL (PGlite) aprobadas: catálogo, RLS, precios, reservas, cambios, cancelaciones, pagos idempotentes, canje/reintegro de puntos, reseñas, soporte e historial.
- Compilación de producción con Vite aprobada.
- Interfaz comprobada en Chrome a 1440 × 1000 y 390 × 844.
- Comprobados catálogo de 17 productos, búsqueda, comparador de tres puestos, cierre por Escape, vista previa sin escritura, inicio de sesión, modo oscuro y navegación móvil.
- No hubo errores JavaScript durante la comprobación visual.
- Capturas disponibles en qa/escritorio.png y qa/movil.png.

Pendiente: crear el proyecto real de Supabase, ejecutar scripts, introducir su URL/clave pública en .env.local y probar el registro/inicio de sesión y las compras contra el servicio real. Las pruebas locales de base de datos no comprueban la configuración de Auth, correo o API de un proyecto remoto.

Los pagos son simulados, sin cobros reales. No se ha publicado el sitio.
