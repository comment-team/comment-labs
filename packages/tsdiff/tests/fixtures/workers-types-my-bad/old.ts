export interface DurableObject {
  fetch(request: Request): Response | Promise<Response>;
  alarm?(): void | Promise<void>;
}
