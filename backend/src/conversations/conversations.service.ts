import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message, MessageRole, MessageType } from './entities/message.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
  ) {}

  // Obtener todas las conversaciones ordenadas por último mensaje
  findAll() {
    return this.convRepo.find({
      order: { lastMessageAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const conv = await this.convRepo.findOne({
      where: { id },
      relations: ['messages'],
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }

  async findByPhone(phone: string) {
    return this.convRepo.findOne({ where: { phone } });
  }

  async findOrCreateByPhone(phone: string, name?: string): Promise<Conversation> {
    let conv = await this.findByPhone(phone);
    if (!conv) {
      conv = this.convRepo.create({
        phone,
        contactName: name || phone,
        lastMessageAt: new Date(),
      });
      conv = await this.convRepo.save(conv);
    }
    return conv;
  }

  // Obtener mensajes de una conversación
  async getMessages(conversationId: string, limit = 50) {
    return this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  // Agregar un mensaje a una conversación
  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    options?: {
      type?: MessageType;
      mediaUrl?: string;
      externalId?: string;
    },
  ): Promise<Message> {
    const msg = this.msgRepo.create({
      conversationId,
      role,
      content,
      type: options?.type || MessageType.TEXT,
      mediaUrl: options?.mediaUrl,
      externalId: options?.externalId,
    });
    const saved = await this.msgRepo.save(msg);

    // Actualizar preview de la conversación
    await this.convRepo.update(conversationId, {
      lastMessageAt: new Date(),
      lastMessagePreview: content.substring(0, 100),
      unreadCount:
        role === MessageRole.USER
          ? () => '"unreadCount" + 1'
          : undefined,
    });

    return saved;
  }

  // Obtener historial de chat como array de { role, content }
  async getChatHistory(conversationId: string, limit = 20) {
    const messages = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return messages.reverse().map((m) => ({
      role: m.role === MessageRole.USER ? 'user' : 'assistant',
      content: m.content,
    }));
  }

  // Pausar/reanudar agente IA para una conversación
  async toggleAgent(id: string, paused: boolean) {
    await this.convRepo.update(id, { isAgentPaused: paused });
    return this.findOne(id);
  }

  // Marcar mensajes como leídos
  async markAsRead(conversationId: string) {
    await this.msgRepo.update({ conversationId, isRead: false }, { isRead: true });
    await this.convRepo.update(conversationId, { unreadCount: 0 });
  }

  // Actualizar nombre del contacto
  async updateContactName(conversationId: string, name: string) {
    await this.convRepo.update(conversationId, { contactName: name });
  }

  // Vincular contactId
  async linkContact(phone: string, contactId: string) {
    await this.convRepo.update({ phone }, { contactId });
  }

  // Avanzar etapa del flujo
  async setStage(conversationId: string, stage: string) {
    await this.convRepo.update(conversationId, { stage: stage as any });
  }

  // Pausar bot en TODAS las conversaciones (para proteger chats existentes)
  async pauseAllExisting() {
    await this.convRepo.update({}, { isAgentPaused: true });
    return { message: 'Bot pausado en todas las conversaciones existentes' };
  }
}
