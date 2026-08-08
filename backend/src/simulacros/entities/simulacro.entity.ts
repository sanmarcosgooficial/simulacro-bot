import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SimulacroStatus {
  DISPONIBLE = 'disponible',
  FINALIZADO = 'finalizado',
  CANCELADO = 'cancelado',
}

// Áreas de San Marcos
export const AREAS_SAN_MARCOS = {
  'Área A: Ciencias de la Salud': ['Medicina Humana', 'Enfermería', 'Obstetricia', 'Farmacia y Bioquímica', 'Odontología', 'Medicina Veterinaria', 'Nutrición', 'Tecnología Médica'],
  'Área B: Ciencias Básicas': ['Matemática', 'Física', 'Química', 'Investigación Operativa', 'Genética', 'Biología', 'Estadística', 'Computación Científica'],
  'Área C: Ingeniería': ['Ingeniería de Sistemas e Informática', 'Ingeniería Civil', 'Ingeniería Industrial', 'Ingeniería Electrónica', 'Ingeniería Mecánica', 'Ingeniería Agroindustrial', 'Ingeniería Ambiental'],
  'Área D: Ciencias Económicas y de la Gestión': ['Administración', 'Contabilidad', 'Economía', 'Negocios Internacionales', 'Gestión Tributaria'],
  'Área E: Humanidades y Ciencias Jurídicas y Sociales': ['Derecho', 'Literatura', 'Educación', 'Comunicación Social', 'Psicología', 'Filosofía', 'Sociología', 'Historia', 'Arqueología'],
};

@Entity('simulacros')
export class Simulacro {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string; // Nombre del simulacro

  @Column({ type: 'date' })
  date: string; // Fecha

  @Column({ type: 'time' })
  time: string; // Hora principal (legacy, se mantiene por compatibilidad)

  @Column({ type: 'json', nullable: true })
  schedules: string[] | null; // Lista de horarios: ["10:00 - 13:00", "17:00 - 20:00"]

  @Column({ nullable: true })
  area: string; // Área (null = todas las áreas)

  @Column({
    type: 'enum',
    enum: SimulacroStatus,
    default: SimulacroStatus.DISPONIBLE,
  })
  status: SimulacroStatus;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  flyerUrl: string; // URL del flyer específico de este simulacro

  @Column({ default: true })
  isVirtual: boolean; // Siempre true en esta versión

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
