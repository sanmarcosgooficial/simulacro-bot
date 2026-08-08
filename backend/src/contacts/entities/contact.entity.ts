import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

export enum ContactStatus {
  NUEVO = 'nuevo',
  INTERESADO = 'interesado',
  ESPERANDO_PAGO = 'esperando_pago',
  INSCRITO = 'inscrito',
}

@Entity('contacts')
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ unique: true })
  phone: string;

  @Column({ nullable: true })
  career: string; // Carrera del alumno (ej: Medicina, Derecho)

  @Column({ nullable: true })
  area: string; // Área identificada (ej: Biomédicas, Sociales)

  @Column({
    type: 'enum',
    enum: ContactStatus,
    default: ContactStatus.NUEVO,
  })
  status: ContactStatus;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ nullable: true })
  yCloudContactId: string; // ID del contacto en YCloud

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
