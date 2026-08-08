import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from './message.entity';

export enum ConversationStage {
  NUEVA           = 'nueva',           // Nunca respondida
  SALUDADA        = 'saludada',        // Bot saludó y preguntó carrera
  CON_CARRERA     = 'con_carrera',     // Carrera detectada, preguntó experiencia
  CON_EXPERIENCIA = 'con_experiencia', // Experiencia conocida, envió flyer, preguntó "¿te gustaría ponerte a prueba?"
  CONFIRMANDO     = 'confirmando',     // Cliente dijo sí, bot preguntó horario
  CON_HORARIO     = 'con_horario',     // Horario conocido, mostró precio
  ESPERANDO_PAGO  = 'esperando_pago',  // Quiere pagar, esperando comprobante
  INSCRITO        = 'inscrito',        // Pago confirmado
}

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phone: string; // Teléfono del contacto (clave principal de identificación)

  @Column({ nullable: true })
  contactId: string; // Referencia al Contact

  @Column({ nullable: true })
  contactName: string;

  @Column({ default: false })
  isAgentPaused: boolean; // Cuando el admin quiere responder manualmente

  @Column({ default: ConversationStage.NUEVA })
  stage: ConversationStage; // Etapa actual del flujo de ventas

  @Column({ nullable: true })
  lastMessageAt: Date;

  @Column({ nullable: true })
  lastMessagePreview: string;

  @Column({ default: 0 })
  unreadCount: number;

  @OneToMany(() => Message, (m) => m.conversation, { cascade: true })
  messages: Message[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
