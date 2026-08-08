import { Module } from '@nestjs/common';
import { YCloudService } from './ycloud.service';

@Module({
  providers: [YCloudService],
  exports: [YCloudService],
})
export class YCloudModule {}
