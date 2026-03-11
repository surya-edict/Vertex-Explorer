/**
 * Framer Motion spring physics configurations
 * From the architectural blueprint — exact values specified
 */

/** Snappy: context menus, hover states, dropdowns — fast and responsive */
export const SPRING_SNAPPY = { type: 'spring' as const, stiffness: 400, damping: 25 };

/** Morphing: list ↔ grid view transitions — allows visual tracking */
export const SPRING_MORPHING = { type: 'spring' as const, stiffness: 200, damping: 20 };

/** Heavy: panel opening, preview windows — conveys weight */
export const SPRING_HEAVY = { type: 'spring' as const, stiffness: 100, damping: 15, mass: 1.5 };
