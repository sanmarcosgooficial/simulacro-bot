import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface SseEvent {
  type: string;
  data: any;
}

@Injectable()
export class SseService {
  private readonly subject = new Subject<SseEvent>();

  // Obtener el observable para los clientes SSE
  getObservable(): Observable<SseEvent> {
    return this.subject.asObservable();
  }

  // Emitir un evento a todos los clientes conectados
  emit(type: string, data: any) {
    this.subject.next({ type, data });
  }

  // Evento: nuevo mensaje recibido
  emitNewMessage(conversationId: string, message: any) {
    this.emit('new_message', { conversationId, message });
  }

  // Evento: estado de contacto actualizado
  emitContactUpdated(contact: any) {
    this.emit('contact_updated', contact);
  }

  // Evento: dashboard actualizado
  emitDashboardUpdate(stats: any) {
    this.emit('dashboard_update', stats);
  }

  // Evento: nueva conversación
  emitNewConversation(conversation: any) {
    this.emit('new_conversation', conversation);
  }

  // Evento: conversación actualizada (ej. bot pausado/reanudado)
  emitConversationUpdated(conversation: any) {
    this.emit('conversation_updated', conversation);
  }
}
