import { PartialType } from '@nestjs/swagger';
import { CreateSimulacroDto } from './create-simulacro.dto';

export class UpdateSimulacroDto extends PartialType(CreateSimulacroDto) {}
