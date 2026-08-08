import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Simulacro, SimulacroStatus, AREAS_SAN_MARCOS } from './entities/simulacro.entity';
import { CreateSimulacroDto } from './dto/create-simulacro.dto';
import { UpdateSimulacroDto } from './dto/update-simulacro.dto';

@Injectable()
export class SimulacrosService {
  constructor(
    @InjectRepository(Simulacro)
    private readonly repo: Repository<Simulacro>,
  ) {}

  findAll() {
    return this.repo.find({ order: { date: 'ASC', time: 'ASC' } });
  }

  async findActive() {
    return this.repo.find({
      where: { status: SimulacroStatus.DISPONIBLE },
      order: { date: 'ASC' },
    });
  }

  async findOne(id: string) {
    const sim = await this.repo.findOne({ where: { id } });
    if (!sim) throw new NotFoundException('Simulacro no encontrado');
    return sim;
  }

  create(dto: CreateSimulacroDto) {
    const sim = this.repo.create({ ...dto, isVirtual: true });
    return this.repo.save(sim);
  }

  async update(id: string, dto: UpdateSimulacroDto) {
    const sim = await this.findOne(id);
    Object.assign(sim, dto);
    return this.repo.save(sim);
  }

  async remove(id: string) {
    const sim = await this.findOne(id);
    await this.repo.remove(sim);
    return { message: 'Simulacro eliminado' };
  }

  // Identificar área a partir de la carrera
  identifyArea(career: string): string | null {
    if (!career) return null;
    const normalizedCareer = career.toLowerCase().trim();

    for (const [area, careers] of Object.entries(AREAS_SAN_MARCOS)) {
      for (const c of careers) {
        if (
          c.toLowerCase().includes(normalizedCareer) ||
          normalizedCareer.includes(c.toLowerCase())
        ) {
          return area;
        }
      }
    }
    return null;
  }

  // Obtener todas las áreas y carreras
  getAreasInfo() {
    return AREAS_SAN_MARCOS;
  }
}
