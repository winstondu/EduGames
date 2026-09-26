/**
 * Keyed actor pool: keeps one view object per live engine entity (by id),
 * recycling released ones instead of creating/destroying every frame.
 */
export interface PoolHooks<T extends { id: number }, A> {
  create(): A
  /** Called when an actor is (re)bound to a new entity. */
  bind(actor: A, item: T): void
  /** Called every sync for each live entity. */
  update(actor: A, item: T): void
  /** Called when the entity disappears; the actor goes back to the free list. */
  release(actor: A): void
}

export class EntityPool<T extends { id: number }, A> {
  private readonly hooks: PoolHooks<T, A>
  private readonly live = new Map<number, A>()
  private readonly free: A[] = []
  private readonly seen = new Set<number>()

  constructor(hooks: PoolHooks<T, A>) {
    this.hooks = hooks
  }

  /** Bind/update actors for `items`; release actors whose entity is gone. */
  sync(items: readonly T[]): void {
    this.seen.clear()
    for (const item of items) {
      this.seen.add(item.id)
      let actor = this.live.get(item.id)
      if (actor === undefined) {
        actor = this.free.pop() ?? this.hooks.create()
        this.live.set(item.id, actor)
        this.hooks.bind(actor, item)
      }
      this.hooks.update(actor, item)
    }
    for (const [id, actor] of this.live) {
      if (this.seen.has(id)) continue
      this.live.delete(id)
      this.hooks.release(actor)
      this.free.push(actor)
    }
  }

  /** Actor currently bound to entity `id` (still valid until the next sync after it vanished). */
  get(id: number): A | undefined {
    return this.live.get(id)
  }

  get size(): number {
    return this.live.size
  }

  /** Every actor ever created (live and free), e.g. for disposal. */
  all(): A[] {
    return [...this.live.values(), ...this.free]
  }
}
