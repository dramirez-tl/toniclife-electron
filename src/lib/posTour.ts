// Tour guiado de primera vez para el POS (misma dependencia y convención que el
// panel del distribuidor en toniclife-next: driver.js + anclas data-tour).
// Es omitible (✕) y repetible desde el botón de ayuda del header. Solo corre
// cuando la terminal está LIBERADA (con el gate "próximamente" no hay nada que
// recorrer: el catálogo/carrito no existen en el DOM y el filtro los tiraría).

import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_KEY = 'tl_pos_tour_v1';

export function hasSeenPosTour(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === '1';
  } catch {
    return true;
  }
}

export function markPosTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, '1');
  } catch {
    /* localStorage no disponible: no bloquea el tour */
  }
}

/**
 * Construye y arranca el recorrido. Filtra los pasos cuyo elemento ancla no
 * exista en el DOM (defensivo: paneles plegados, botones condicionales).
 */
export function startPosTour(): void {
  const steps: DriveStep[] = [
    {
      popover: {
        title: '👋 ¡Bienvenido al punto de venta!',
        description:
          'Te damos un recorrido rápido por la terminal. Puedes omitirlo cuando ' +
          'quieras con la ✕ y repetirlo después desde el botón de ayuda (?).',
      },
    },
    {
      element: '[data-tour="pos-branch"]',
      popover: {
        title: 'Tu sucursal',
        description:
          'País, clave y nombre de la sucursal donde está activada esta terminal. ' +
          'Todas las ventas y la hora se registran con la zona horaria de la sucursal.',
      },
    },
    {
      element: '[data-tour="pos-status"]',
      popover: {
        title: 'Conexión y hora',
        description:
          'El indicador muestra si la terminal está en línea con el servidor; ' +
          'junto está la fecha y hora oficiales de la sucursal.',
      },
    },
    {
      element: '[data-tour="pos-refresh"]',
      popover: {
        title: 'Actualizar',
        description:
          'Fuerza una sincronización inmediata: re-valida el estado de la terminal ' +
          'y refresca catálogo y ventas sin cerrar la aplicación.',
      },
    },
    {
      element: '[data-tour="pos-printer"]',
      popover: {
        title: 'Impresora térmica',
        description:
          'Configura aquí la impresora de tickets (red o del sistema, 58/80 mm y ' +
          'cajón de dinero). Puedes imprimir una página de prueba.',
      },
    },
    {
      element: '[data-tour="pos-register"]',
      popover: {
        title: 'Registrar',
        description:
          'Da de alta a un distribuidor nuevo o a un cliente preferente desde la ' +
          'sucursal, con su patrocinador y kit de inscripción.',
      },
    },
    {
      element: '[data-tour="pos-transfers"]',
      popover: {
        title: 'Entradas de inventario',
        description:
          'Recibe los traspasos de producto que llegan a tu sucursal. El globito ' +
          'ámbar indica cuántos están pendientes por recibir.',
      },
    },
    {
      element: '[data-tour="pos-sales-panel"]',
      popover: {
        title: 'Ventas del día',
        description:
          'Las ventas recientes de la sucursal: consulta el detalle de cada una, ' +
          'reimprime tickets y navega por fecha. Puedes plegar este panel.',
      },
    },
    {
      element: '[data-tour="pos-corte"]',
      popover: {
        title: 'Corte del día',
        description:
          'El resumen de ventas y cobros del día por método de pago, listo para ' +
          'imprimir al cierre.',
      },
    },
    {
      element: '[data-tour="pos-catalog"]',
      popover: {
        title: 'Catálogo',
        description:
          'Busca productos por nombre o código y tócalos para agregarlos a la ' +
          'venta. Aquí también aparecen los kits de inscripción y las promociones.',
      },
    },
    {
      element: '[data-tour="pos-cart"]',
      popover: {
        title: 'Carrito y cobro',
        description:
          'La venta en curso: cantidades, descuentos y cliente. Al cobrar eliges ' +
          'métodos de pago y, si el cliente lo pide, su factura.',
      },
    },
    {
      element: '[data-tour="pos-help"]',
      popover: {
        title: '¿Quieres verlo otra vez?',
        description:
          'Repite este recorrido cuando quieras desde este botón. ¡Buenas ventas! 🚀',
      },
    },
  ];

  const filtered = steps.filter(
    (s) => !s.element || document.querySelector(s.element as string),
  );

  const drv = driver({
    showProgress: true,
    allowClose: true,
    disableActiveInteraction: true,
    overlayColor: 'rgba(0, 42, 92, 0.7)',
    popoverClass: 'tl-tour',
    nextBtnText: 'Siguiente',
    prevBtnText: 'Atrás',
    doneBtnText: 'Listo',
    progressText: '{{current}} de {{total}}',
    steps: filtered,
    onDestroyed: () => {
      markPosTourSeen();
    },
  });

  drv.drive();
}
