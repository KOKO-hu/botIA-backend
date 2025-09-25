import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    const { email, googleId, name, avatar } = await this.authService.verifyGoogleIdToken(dto.idToken);
    const { userId, sessionId } = await this.authService.upsertGoogleUser(email, googleId, name, avatar);
    const token = this.authService.issueToken(userId, sessionId);
    return { userId, sessionId, token };
  }
}


