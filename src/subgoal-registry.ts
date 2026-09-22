export class SubgoalRegistry {
  private active=new Set<string>();
  register(key:string): boolean {
    if(this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }
  complete(key:string){ this.active.delete(key); }
  has(key:string){ return this.active.has(key); }
}