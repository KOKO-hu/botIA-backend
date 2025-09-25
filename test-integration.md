# Test d'intégration - Chat avec LangChain + Qdrant

## 🧪 Tests à effectuer

### 1. Test de santé de l'API
```bash
curl http://localhost:3000/chat/health
```

**Résultat attendu :**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 2. Test d'une question simple
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Quelle est la loi sur le travail ?"}'
```

**Résultat attendu :**
- Réponse générée par LangChain (si OpenAI configuré)
- Documents pertinents de Qdrant
- Session ID généré

### 3. Test avec session existante
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Peux-tu me donner plus de détails ?", "sessionId": "session_1234567890_abc123"}'
```

**Résultat attendu :**
- Réponse qui prend en compte l'historique
- Même session ID retourné

### 4. Test d'effacement de conversation
```bash
curl -X DELETE http://localhost:3000/chat/session_1234567890_abc123
```

**Résultat attendu :**
```json
{
  "message": "Conversation effacée avec succès"
}
```

## 🔧 Configuration requise

### Variables d'environnement (.env)
```env
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your_qdrant_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
NODE_ENV=development
```

### Prérequis
1. **Qdrant** : Instance Qdrant en cours d'exécution
2. **Collection** : Collection nommée `legal_documents` avec des documents
3. **OpenAI** : Clé API OpenAI valide

## 🚨 Gestion des erreurs

### Si LangChain n'est pas configuré
- L'API fonctionne avec des réponses basiques
- Les embeddings ne sont pas générés
- Recherche avec vecteur vide

### Si Qdrant n'est pas accessible
- Erreur lors de la recherche
- Réponse indiquant l'absence de documents

### Si OpenAI n'est pas configuré
- Embeddings non générés
- Réponses basiques au lieu de LangChain
- Logs d'avertissement

## 📊 Logs à surveiller

```bash
# Démarrage de l'application
npm run start:dev

# Logs attendus :
# - "MemoryService initialisé"
# - "EmbeddingService initialisé avec OpenAI" (si configuré)
# - "LangChainService initialisé avec OpenAI GPT-3.5-turbo" (si configuré)
# - "QdrantService initialisé"
```

## ✅ Critères de succès

1. **API démarre** sans erreur
2. **Endpoint health** répond correctement
3. **Question simple** génère une réponse
4. **Sessions** sont gérées correctement
5. **Logs** montrent le bon fonctionnement des services
