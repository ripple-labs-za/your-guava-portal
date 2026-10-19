// Text colours meet 4.5:1 on their 0x18 tint over the dark staff card (ISSUES #79).
export const FALLBACK_ROLE_COLOR = '#9A9A9A'

export const ROLE_COLORS: Record<string, string> = {
  barista: '#E76161',
  kitchen: '#E58A3C',
  front: '#4A9ECC',
  manager: '#B07CC6',
  other: FALLBACK_ROLE_COLOR,
}
