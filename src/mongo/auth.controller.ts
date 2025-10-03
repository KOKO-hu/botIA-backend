import { Body, Controller, Logger, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  private readonly logger = new Logger(AuthController.name);

  @Post('register')
  async register(@Body() dto: { email: string; password: string }) {
    const { userId } = await this.authService.register(dto.email, dto.password);
    const { sessionId } = await this.authService.login(dto.email, dto.password);
    const token = this.authService.issueToken(userId, sessionId);
    return { userId, sessionId, token };
  }

  @Post('login')
  async login(@Body() dto: { email: string; password: string }) {
    const { userId, sessionId } = await this.authService.login(dto.email, dto.password);
    const token = this.authService.issueToken(userId, sessionId);
    return { userId, sessionId, token };
  }

  @Post('google')
  async google(@Body() dto: { idToken: string }) {
    this.logger.log('Received Google auth request');
    try {
      const { email, googleId, name, avatar } = await this.authService.verifyGoogleIdToken(dto.idToken);
      this.logger.debug(`Verified Google ID token for email=${email} googleId=${googleId?.slice(0, 6)}...`);
      const { userId, sessionId } = await this.authService.upsertGoogleUser(email, googleId, name, avatar);
      this.logger.log(`Upserted Google user userId=${userId} sessionId=${sessionId}`);
      const token = this.authService.issueToken(userId, sessionId);
      this.logger.log(`Issued token for userId=${userId}`);
      return { userId, sessionId, token };
    } catch (error) {
      this.logger.error('Google auth failed', error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}


