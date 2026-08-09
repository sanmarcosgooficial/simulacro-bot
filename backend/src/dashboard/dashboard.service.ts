import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Contact, ContactStatus } from '../contacts/entities/contact.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Simulacro, SimulacroStatus } from '../simulacros/entities/simulacro.entity';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Simulacro)
    private readonly simRepo: Repository<Simulacro>,
    private readonly settings: SettingsService,
  ) {}

  async getStats() {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Conteos por estado
    const [
      totalContacts,
      interesados,
      esperandoPago,
      inscritos,
      nuevosHoy,
    ] = await Promise.all([
      this.contactRepo.count(),
      this.contactRepo.count({ where: { status: ContactStatus.INTERESADO } }),
      this.contactRepo.count({ where: { status: ContactStatus.ESPERANDO_PAGO } }),
      this.contactRepo.count({ where: { status: ContactStatus.INSCRITO } }),
      this.contactRepo.count({
        where: {
          createdAt: Between(startOfDay, endOfDay),
        },
      }),
    ]);

    // Conversaciones recientes (últimas 5)
    const recentConversations = await this.convRepo.find({
      order: { lastMessageAt: 'DESC' },
      take: 5,
    });

    // Simulacros próximos
    const upcomingSimulacros = await this.simRepo.find({
      where: { status: SimulacroStatus.DISPONIBLE },
      order: { date: 'ASC' },
      take: 3,
    });

    // Configuración del agente
    const settings = await this.settings.getAll();
    const agentEnabled = settings.agent_enabled === 'true';

    // Precio configurado
    const price = parseFloat(settings.price || '50');

    // Ventas del día (inscritos que se actualizaron hoy)
    const ventasHoy = await this.contactRepo.count({
      where: {
        status: ContactStatus.INSCRITO,
        updatedAt: Between(startOfDay, endOfDay),
      },
    });

    return {
      contacts: {
        total: totalContacts,
        interesados,
        esperandoPago,
        inscritos,
        nuevosHoy,
      },
      sales: {
        ventasHoy,
        montoHoy: ventasHoy * price,
        precio: price,
      },
      recentConversations,
      upcomingSimulacros,
      agent: {
        enabled: agentEnabled,
        model: settings.ai_model,
      },
    };
  }
}
