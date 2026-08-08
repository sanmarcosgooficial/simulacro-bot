import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Contact, ContactStatus } from './entities/contact.entity';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly repo: Repository<Contact>,
  ) {}

  async findAll(search?: string, status?: ContactStatus) {
    const where: any = {};
    if (status) where.status = status;

    if (search) {
      return this.repo.find({
        where: [
          { name: Like(`%${search}%`), ...where },
          { phone: Like(`%${search}%`), ...where },
          { career: Like(`%${search}%`), ...where },
        ],
        order: { updatedAt: 'DESC' },
      });
    }

    return this.repo.find({ where, order: { updatedAt: 'DESC' } });
  }

  async findOne(id: string) {
    const contact = await this.repo.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return contact;
  }

  async findByPhone(phone: string) {
    return this.repo.findOne({ where: { phone } });
  }

  async create(dto: CreateContactDto) {
    const existing = await this.repo.findOne({ where: { phone: dto.phone } });
    if (existing) throw new ConflictException('Ya existe un contacto con ese teléfono');

    const contact = this.repo.create(dto);
    return this.repo.save(contact);
  }

  async findOrCreate(phone: string, name?: string): Promise<Contact> {
    let contact = await this.findByPhone(phone);
    if (!contact) {
      contact = await this.repo.save(
        this.repo.create({ phone, name, status: ContactStatus.NUEVO }),
      );
    }
    return contact;
  }

  async update(id: string, dto: UpdateContactDto) {
    const contact = await this.findOne(id);
    Object.assign(contact, dto);
    return this.repo.save(contact);
  }

  async updateByPhone(phone: string, data: Partial<Contact>) {
    const contact = await this.findByPhone(phone);
    if (!contact) return null;
    Object.assign(contact, data);
    return this.repo.save(contact);
  }

  async remove(id: string) {
    const contact = await this.findOne(id);
    await this.repo.remove(contact);
    return { message: 'Contacto eliminado' };
  }

  async getStats() {
    const total = await this.repo.count();
    const byStatus = await this.repo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status')
      .getRawMany();

    return { total, byStatus };
  }
}
