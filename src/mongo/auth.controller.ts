import { Body, Controller, Logger, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  private readonly logger = new Logger(AuthController.name);

  @Post('register')
  async register(@Body() dto: { email: string; password: string }) {
    const startedAt = Date.now();
    this.logger.log(`Register requested for email=${dto?.email?.toLowerCase()?.trim()}`);
    try {
      const { userId } = await this.authService.register(dto.email, dto.password);
      this.logger.log(`Register success userId=${userId}`);
      const { sessionId } = await this.authService.login(dto.email, dto.password);
      this.logger.log(`Auto-login success userId=${userId} sessionId=${sessionId}`);
      const token = this.authService.issueToken(userId, sessionId);
      this.logger.log(`Token issued for userId=${userId} in ${Date.now() - startedAt}ms`);
      return { userId, sessionId, token };
    } catch (error) {
      this.logger.error(`Register failed for email=${dto?.email?.toLowerCase()?.trim()}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  @Post('login')
  async login(@Body() dto: { email: string; password: string }) {
    const startedAt = Date.now();
    this.logger.log(`Login requested for email=${dto?.email?.toLowerCase()?.trim()}`);
    try {
      const { userId, sessionId } = await this.authService.login(dto.email, dto.password);
      this.logger.log(`Login success userId=${userId} sessionId=${sessionId}`);
      const token = this.authService.issueToken(userId, sessionId);
      this.logger.log(`Token issued for userId=${userId} in ${Date.now() - startedAt}ms`);
      return { userId, sessionId, token };
    } catch (error) {
      this.logger.warn(`Login failed for email=${dto?.email?.toLowerCase()?.trim()}`);
      throw error;
    }
  }

  @Post('google')
  async google(@Body() dto: { idToken: string }) {
    const startedAt = Date.now();
    this.logger.log('Received Google auth request');
    try {
      const { email, googleId, name, avatar } = await this.authService.verifyGoogleIdToken(dto.idToken);
      this.logger.debug(`Verified Google ID token for email=${email} googleId=${googleId?.slice(0, 6)}...`);
      const { userId, sessionId } = await this.authService.upsertGoogleUser(email, googleId, name, avatar);
      this.logger.log(`Upserted Google user userId=${userId} sessionId=${sessionId}`);
      const token = this.authService.issueToken(userId, sessionId);
      this.logger.log(`Issued token for userId=${userId} in ${Date.now() - startedAt}ms`);
      return { userId, sessionId, token };
    } catch (error) {
      this.logger.error('Google auth failed', error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}


