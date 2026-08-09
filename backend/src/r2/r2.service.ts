import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { extname } from 'path';

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get('R2_BUCKET', 'simulacro-flyres');
    this.publicUrl = config.get('R2_PUBLIC_URL', '').replace(/\/$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async uploadFile(file: Express.Multer.File, prefix = 'flyer'): Promise<string> {
    const ext = extname(file.originalname);
    const filename = `${prefix}-${Date.now()}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return `${this.publicUrl}/${filename}`;
  }
}
