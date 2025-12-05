import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone"
import { MistralAIEmbeddings } from "@langchain/mistralai";

@Injectable()
export class PineconeService {
    private pineconeIndex: any;
    private embeddings: MistralAIEmbeddings;
  constructor(private readonly configService: ConfigService) {
    const pinecone = new PineconeClient({
        apiKey: this.configService.get<string>("PINECONE_API_KEY"),
      });
       this.pineconeIndex = pinecone.Index(this.configService.get<string>('PINECONE_INDEX'));

        this.embeddings = new MistralAIEmbeddings({
        model: "mistral-embed",
        apiKey: this.configService.get<string>("MISTRAL_API_KEY"),
      });
  }
  async search(query: string): Promise<string> {
    // 1️⃣ Générer le vecteur avec Mistral Embedding


    const vector = await this.embeddings.embedQuery(query);

    // 2️⃣ Faire la recherche Pinecone
    const results = await this.pineconeIndex.query({
      vector,
      topK: 3,
      includeMetadata: true,
    });
    if (!results.matches || results.matches.length === 0) {
        return "Aucun passage juridique trouvé dans la base de données.";
      }
console.log("results", results);
    // 3️⃣ Retourner les textes juridiques trouvés
    return results.matches
      .map((match) => match.metadata?.contenu ?? "")
      .join("\n");
  }



  async searchChat(query: string): Promise<string> {
    const vector = await this.embeddings.embedQuery(query);
  
    const results = await this.pineconeIndex.query({
      vector,
      topK: 3, // Plus concis pour LLM
      includeMetadata: true,
    });
  
    if (!results.matches || results.matches.length === 0) {
      return "Aucun passage juridique trouvé dans la base de données.";
    }
  
    // ✅ ENRICHIR avec métadonnées sources
    const enrichedResults = results.matches
      .map((match, index) => {
        const meta = match.metadata || {};
        return `
  === SOURCE ${index + 1} ===
  📄 **Texte** : ${meta.contenu || ''}
  🔗 **URL PDF** : ${meta.url || 'N/A'}
  📚 **Loi** : ${meta.numero_loi || 'N/A'} (${meta.date_loi || 'N/A'})
  📄 **Pages** : ${meta.s3_pages_root || 'N/A'}
  🎯 **Article** : ${meta.numero_article || 'N/A'}
        `.trim();
      })
      .join("\n\n---\n\n");
  
    console.log("✅ Sources enrichies envoyées au LLM");
    return enrichedResults;
  }
}