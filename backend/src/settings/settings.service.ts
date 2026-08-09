import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';
import { Contact } from '../contacts/entities/contact.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../conversations/entities/message.entity';

// Configuraciones por defecto del sistema
const DEFAULT_SETTINGS = [
  { key: 'business_name', value: 'San Marcos GO', description: 'Nombre del negocio' },
  { key: 'price', value: '19', description: 'Precio del simulacro en soles' },
  { key: 'yape_number', value: '978069398', description: 'Número de Yape para pagos' },
  { key: 'yape_name', value: 'Pool Nuñez', description: 'Nombre del titular de Yape' },
  { key: 'agent_tone', value: 'amigable', description: 'Tono del agente: amigable, formal, cercano' },
  { key: 'ai_model', value: 'gpt-4o-mini', description: 'Modelo de IA (OpenAI)' },
  { key: 'flyer_url', value: '', description: 'URL del flyer del simulacro' },
  { key: 'agent_enabled', value: 'true', description: 'Agente IA activo' },
  { key: 'welcome_message', value: '¡Hola! 👋 Soy el asistente de Simulacros San Marcos. ¿En qué te puedo ayudar?', description: 'Mensaje de bienvenida' },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    @InjectRepository(Setting)
    private readonly repo: Repository<Setting>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
  ) {}

  async onModuleInit() {
    // Crear configuraciones por defecto si no existen
    for (const setting of DEFAULT_SETTINGS) {
      const exists = await this.repo.findOne({ where: { key: setting.key } });
      if (!exists) {
        await this.repo.save(this.repo.create(setting));
      }
    }

    // Migración: eliminar la clave antigua 'openai_model' (reemplazada por 'ai_model')
    await this.repo.delete({ key: 'openai_model' });

    // Migración: valores de 'ai_model' de la era Gemini → resetear al default OpenAI.
    // La BD tiene prioridad sobre el .env, así que sin esto el bot seguiría usando
    // un modelo de Gemini contra el endpoint de OpenAI.
    const aiModel = await this.repo.findOne({ where: { key: 'ai_model' } });
    if (aiModel && aiModel.value.startsWith('gemini-')) {
      aiModel.value = 'gpt-4o-mini';
      await this.repo.save(aiModel);
    }
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.repo.find();
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    const setting = await this.repo.findOne({ where: { key } });
    return setting?.value ?? null;
  }

  async set(key: string, value: string): Promise<Setting> {
    let setting = await this.repo.findOne({ where: { key } });
    if (!setting) {
      setting = this.repo.create({ key, value });
    } else {
      setting.value = value;
    }
    return this.repo.save(setting);
  }

  async updateMany(updates: Record<string, string>): Promise<Record<string, string>> {
    for (const [key, value] of Object.entries(updates)) {
      await this.set(key, value);
    }
    return this.getAll();
  }

  // Limpiar todos los datos de prueba de un número de teléfono
  async clearTestData(phone: string): Promise<{ message: string; deleted: Record<string, number> }> {
    if (!phone) throw new BadRequestException('Debes indicar un número de teléfono');

    // Normalizar el teléfono
    const normalized = phone.startsWith('+') ? phone : `+${phone}`;

    // Buscar la conversación para poder borrar sus mensajes
    const conversation = await this.convRepo.findOne({ where: { phone: normalized } });

    let messagesDeleted = 0;
    if (conversation) {
      const result = await this.msgRepo.delete({ conversationId: conversation.id });
      messagesDeleted = result.affected || 0;
    }

    // Borrar conversación (CASCADE borra mensajes también, pero ya los borramos)
    const convResult = await this.convRepo.delete({ phone: normalized });

    // Borrar contacto
    const contactResult = await this.contactRepo.delete({ phone: normalized });

    return {
      message: `Datos de ${normalized} eliminados correctamente`,
      deleted: {
        mensajes: messagesDeleted,
        conversaciones: convResult.affected || 0,
        contactos: contactResult.affected || 0,
      },
    };
  }
}
