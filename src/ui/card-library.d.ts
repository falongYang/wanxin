export type CardRecord = { id: string; title: string; body: string; createdAt: string }
export type CardGroup<T extends CardRecord> = { key: string; label: string; cards: T[] }
export function groupCards<T extends CardRecord>(cards: readonly T[], query: string): CardGroup<T>[]
