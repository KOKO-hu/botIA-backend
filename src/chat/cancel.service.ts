import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CancelService {
  private readonly logger = new Logger(CancelService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  createAbortController(sessionId: string): AbortController {
    // Supprimer l'ancien contrôleur s'il existe
    this.abortControllers.delete(sessionId);
    
    // Créer un nouveau contrôleur
    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);
    
    this.logger.log(`AbortController créé pour la session: ${sessionId}`);
    return controller;
  }

  getAbortController(sessionId: string): AbortController | undefined {
    return this.abortControllers.get(sessionId);
  }

  cancelRequest(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      this.logger.log(`Requête annulée pour la session: ${sessionId}`);
      return true;
    }
    return false;
  }

  cleanup(sessionId: string): void {
    this.abortControllers.delete(sessionId);
    this.logger.log(`AbortController nettoyé pour la session: ${sessionId}`);
  }

  // Nettoyer automatiquement les contrôleurs expirés (optionnel)
  cleanupExpired(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];
    
    this.abortControllers.forEach((controller, sessionId) => {
      if (controller.signal.aborted) {
        expiredSessions.push(sessionId);
      }
    });
    
    expiredSessions.forEach(sessionId => {
      this.abortControllers.delete(sessionId);
    });
    
    if (expiredSessions.length > 0) {
      this.logger.log(`Nettoyage automatique de ${expiredSessions.length} sessions expirées`);
    }
  }
}
