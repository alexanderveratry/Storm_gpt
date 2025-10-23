import os
import json
from pathlib import Path
from docx import Document
from openai import OpenAI
from collections import Counter
import pandas as pd
from typing import List, Dict, Tuple

# Configuración de API
api_key = os.environ.get("OPENAI_API_KEY") or "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"

try:
    client = OpenAI(api_key=api_key)
    GPT_MODEL = "gpt-4o"  # Mejor para análisis complejo
except Exception as e:
    print(f"❌ Error configurando cliente OpenAI: {e}")
    client = None
    GPT_MODEL = None

# Preguntas del examen
PREGUNTAS = [
    "¿En qué consiste un fondo 130/30 fund? ¿Cuáles son las ventajas y desventajas de estos fondos con respecto a fondos 'long-only'?",
    "¿En qué consiste la estrategia low-vol? ¿Qué anomalía empírica da pie para implementar esta estrategia?",
    "¿Qué argumentos a favor tenía Martingale para continuar/expandir estrategias 130/30 + low_vol en ese entonces?"
]

class AnswerPatternAnalyzer:
    def __init__(self, folder_path: str):
        self.folder_path = Path(folder_path)
        self.documents = []
        self.extracted_answers = []
        self.pattern_analysis = {}
        self.rubric = {}
        
    def validate_folder_structure(self):
        """Valida y muestra la estructura de carpetas"""
        print("🔍 Validando estructura de carpetas...")
        
        if not self.folder_path.exists():
            print(f"❌ Error: La carpeta '{self.folder_path}' no existe")
            return False
        
        # Buscar subcarpetas
        subfolders = [f for f in self.folder_path.iterdir() if f.is_dir()]
        
        if not subfolders:
            print("⚠️  No se encontraron subcarpetas. Buscando archivos Word en la carpeta raíz...")
            docx_files = list(self.folder_path.glob("*.docx"))
            if docx_files:
                print(f"✅ Encontrados {len(docx_files)} archivos Word en la carpeta raíz")
                return True
            else:
                print("❌ No se encontraron archivos Word")
                return False
        
        print(f"✅ Encontradas {len(subfolders)} subcarpetas:")
        
        total_docx = 0
        for subfolder in subfolders:
            docx_files = list(subfolder.glob("*.docx"))
            docx_files = [f for f in docx_files if not f.name.startswith('~$')]
            total_docx += len(docx_files)
            
            status = "✅" if docx_files else "⚠️"
            print(f"  {status} {subfolder.name}/ - {len(docx_files)} archivo(s) Word")
            
            if docx_files:
                for docx_file in docx_files:
                    print(f"    📄 {docx_file.name}")
        
        if total_docx == 0:
            print("❌ No se encontraron archivos Word en ninguna subcarpeta")
            return False
        
        print(f"\n✅ Total: {total_docx} archivos Word encontrados")
        return True
        
    def load_documents(self):
        """Carga todos los documentos Word desde carpetas anidadas"""
        print("📁 Cargando documentos Word desde carpetas...")
        
        # Buscar archivos .docx en todas las subcarpetas
        docx_files = list(self.folder_path.rglob("*.docx"))
        docx_files = [f for f in docx_files if not f.name.startswith('~$')]
        
        print(f"Encontrados {len(docx_files)} archivos Word en las subcarpetas")
        
        for file_path in docx_files:
            try:
                doc = Document(file_path)
                full_text = "\n".join([para.text for para in doc.paragraphs])
                
                # Usar el nombre de la carpeta padre como nombre del estudiante
                student_folder = file_path.parent.name
                
                self.documents.append({
                    'filename': file_path.name,
                    'student_name': student_folder,
                    'folder_path': str(file_path.parent),
                    'full_text': full_text
                })
                print(f"✓ {student_folder}/{file_path.name}")
            except Exception as e:
                print(f"✗ Error en {file_path}: {e}")
        
        print(f"\n✅ Total documentos cargados: {len(self.documents)}")
        
        # Mostrar estructura encontrada
        if self.documents:
            print("\n📂 Estructura encontrada:")
            folders = set(doc['student_name'] for doc in self.documents)
            for folder in sorted(folders):
                files_in_folder = [doc['filename'] for doc in self.documents if doc['student_name'] == folder]
                print(f"  📁 {folder}/")
                for file in files_in_folder:
                    print(f"    📄 {file}")
        print()
    
    def extract_answers_from_document(self, doc_data: Dict, doc_index: int) -> Dict:
        """Extrae y analiza respuestas de un documento individual usando GPT"""
        print(f"\n{'='*80}")
        print(f"📄 Analizando: {doc_data['student_name']} ({doc_index + 1}/{len(self.documents)})")
        print(f"{'='*80}")
        
        # Contexto acumulado de documentos anteriores
        context = ""
        if self.extracted_answers:
            context = "\n\n### CONTEXTO DE DOCUMENTOS ANTERIORES:\n"
            context += "Has analizado los siguientes documentos previamente:\n\n"
            for prev in self.extracted_answers[-3:]:  # Últimos 3 para no sobrecargar
                context += f"Documento: {prev['student_name']}\n"
                for q_num, answer in prev['answers'].items():
                    # Verificar que answer sea un diccionario y tenga la clave 'key_points'
                    if isinstance(answer, dict) and 'key_points' in answer:
                        key_points = answer['key_points']
                        if isinstance(key_points, list) and key_points:
                            context += f"  Pregunta {q_num}: {', '.join(key_points[:3])}...\n"
                        elif isinstance(key_points, str):
                            context += f"  Pregunta {q_num}: {key_points[:200]}...\n"
                    else:
                        context += f"  Pregunta {q_num}: [Análisis previo]\n"
                context += "\n"
        
        prompt = f"""Eres un profesor analizando respuestas de estudiantes sobre finanzas. 

{context}

DOCUMENTO ACTUAL: {doc_data['student_name']}

TEXTO COMPLETO:
{doc_data['full_text']}

---

PREGUNTAS DEL EXAMEN:
1. {PREGUNTAS[0]}
2. {PREGUNTAS[1]}
3. {PREGUNTAS[2]}

---

TAREA:
Analiza este documento e identifica las respuestas a cada pregunta. Para cada pregunta, extrae:

1. Los puntos clave mencionados (conceptos, definiciones, ejemplos)
2. Identifica patrones o elementos recurrentes si ya has visto otros documentos
3. Nota similitudes o diferencias con documentos anteriores

Responde en el siguiente formato JSON estricto:

{{
  "pregunta_1": {{
    "respuesta_completa": "Texto de la respuesta tal como aparece",
    "key_points": ["punto 1", "punto 2", "punto 3", ...],
    "conceptos_mencionados": ["concepto A", "concepto B", ...],
    "longitud_caracteres": número,
    "calidad_estimada": "alta/media/baja"
  }},
  "pregunta_2": {{
    "respuesta_completa": "...",
    "key_points": [...],
    "conceptos_mencionados": [...],
    "longitud_caracteres": número,
    "calidad_estimada": "alta/media/baja"
  }},
  "pregunta_3": {{
    "respuesta_completa": "...",
    "key_points": [...],
    "conceptos_mencionados": [...],
    "longitud_caracteres": número,
    "calidad_estimada": "alta/media/baja"
  }},
  "observaciones_generales": "Comentarios sobre este documento comparado con anteriores"
}}

IMPORTANTE: Responde SOLO con el JSON, sin texto adicional antes o después."""

        try:
            if client is None:
                print("❌ Error: Cliente OpenAI no configurado correctamente")
                return None
                
            response = client.chat.completions.create(
                model=GPT_MODEL,
                messages=[
                    {"role": "system", "content": "Eres un profesor experto analizando exámenes de finanzas. Respondes solo en JSON válido."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            
            # Debug: verificar estructura de la respuesta
            print(f"🔍 Debug - Estructura de respuesta recibida:")
            for key, value in result.items():
                print(f"    {key}: {type(value).__name__}")
                if isinstance(value, dict):
                    for subkey in value.keys():
                        print(f"      └─ {subkey}: {type(value[subkey]).__name__}")
            
            # Mostrar resumen en consola
            print(f"\n📊 Análisis del documento:")
            for q_num in ['pregunta_1', 'pregunta_2', 'pregunta_3']:
                if q_num in result and isinstance(result[q_num], dict):
                    q_data = result[q_num]
                    conceptos = q_data.get('conceptos_mencionados', [])
                    key_points = q_data.get('key_points', [])
                    
                    # Asegurar que sean listas
                    if not isinstance(conceptos, list):
                        conceptos = []
                    if not isinstance(key_points, list):
                        key_points = []
                    
                    print(f"\n  {q_num.upper()}:")
                    print(f"    - Conceptos: {', '.join(conceptos) if conceptos else 'N/A'}")
                    print(f"    - Puntos clave: {len(key_points)}")
                    print(f"    - Calidad: {q_data.get('calidad_estimada', 'N/A')}")
            
            if 'observaciones_generales' in result:
                print(f"\n  💭 Observaciones: {result['observaciones_generales']}")
            
            return {
                'student_name': doc_data['student_name'],
                'answers': result
            }
            
        except Exception as e:
            print(f"❌ Error al analizar documento: {e}")
            return None
    
    def analyze_patterns_iteratively(self):
        """Primera iteración: analiza documento por documento acumulando patrones"""
        print("\n" + "="*80)
        print("🔄 PRIMERA ITERACIÓN: ANÁLISIS ITERATIVO DE DOCUMENTOS")
        print("="*80)
        
        for i, doc in enumerate(self.documents):
            analysis = self.extract_answers_from_document(doc, i)
            if analysis:
                self.extracted_answers.append(analysis)
        
        print(f"\n✅ Análisis iterativo completado: {len(self.extracted_answers)} documentos procesados")
    
    def synthesize_patterns(self):
        """Sintetiza patrones encontrados en todas las respuestas"""
        print("\n" + "="*80)
        print("🔍 SÍNTESIS DE PATRONES ENCONTRADOS")
        print("="*80)
        
        for q_num in range(1, 4):
            q_key = f'pregunta_{q_num}'
            print(f"\n{'='*80}")
            print(f"📝 PREGUNTA {q_num}: {PREGUNTAS[q_num-1][:100]}...")
            print(f"{'='*80}")
            
            # Recopilar todos los conceptos mencionados
            all_concepts = []
            all_key_points = []
            quality_counts = Counter()
            
            for doc in self.extracted_answers:
                if q_key in doc['answers'] and isinstance(doc['answers'][q_key], dict):
                    answer_data = doc['answers'][q_key]
                    
                    # Validar y procesar conceptos mencionados
                    conceptos = answer_data.get('conceptos_mencionados', [])
                    if isinstance(conceptos, list):
                        all_concepts.extend(conceptos)
                    
                    # Validar y procesar puntos clave
                    key_points = answer_data.get('key_points', [])
                    if isinstance(key_points, list):
                        all_key_points.extend(key_points)
                    
                    quality_counts[answer_data.get('calidad_estimada', 'N/A')] += 1
            
            # Contar frecuencias
            concept_freq = Counter(all_concepts)
            
            print(f"\n📊 ESTADÍSTICAS:")
            print(f"   Total de respuestas analizadas: {len(self.extracted_answers)}")
            print(f"   Distribución de calidad:")
            for quality, count in quality_counts.most_common():
                print(f"     - {quality}: {count} respuestas")
            
            print(f"\n🔑 CONCEPTOS MÁS MENCIONADOS:")
            for concept, freq in concept_freq.most_common(10):
                percentage = (freq / len(self.extracted_answers)) * 100
                print(f"   • {concept}: {freq} veces ({percentage:.1f}%)")
            
            # Guardar para el informe
            self.pattern_analysis[q_key] = {
                'pregunta': PREGUNTAS[q_num-1],
                'total_respuestas': len(self.extracted_answers),
                'conceptos_frecuentes': dict(concept_freq.most_common(10)),
                'puntos_clave_comunes': all_key_points,
                'distribucion_calidad': dict(quality_counts)
            }
    
    def generate_rubric(self):
        """Segunda iteración: genera pauta basada en respuestas más frecuentes"""
        print("\n" + "="*80)
        print("📋 SEGUNDA ITERACIÓN: GENERACIÓN DE PAUTA")
        print("="*80)
        
        # Preparar contexto con todos los análisis
        context = "Análisis de todas las respuestas:\n\n"
        for q_key, pattern in self.pattern_analysis.items():
            context += f"\n{pattern['pregunta']}\n"
            context += f"Total respuestas: {pattern['total_respuestas']}\n"
            context += f"Conceptos más mencionados:\n"
            for concept, freq in list(pattern['conceptos_frecuentes'].items())[:5]:
                context += f"  - {concept}: {freq} veces\n"
        
        # Incluir ejemplos de respuestas de alta calidad
        high_quality_examples = []
        for doc in self.extracted_answers:
            for q_num in range(1, 4):
                q_key = f'pregunta_{q_num}'
                if q_key in doc['answers']:
                    if doc['answers'][q_key].get('calidad_estimada') == 'alta':
                        high_quality_examples.append({
                            'pregunta': q_num,
                            'estudiante': doc['student_name'],
                            'respuesta': doc['answers'][q_key].get('respuesta_completa', '')[:500]
                        })
        
        context += "\n\nEjemplos de respuestas de alta calidad:\n"
        for ex in high_quality_examples[:6]:  # Máximo 6 ejemplos
            context += f"\nPregunta {ex['pregunta']} - {ex['estudiante']}:\n{ex['respuesta']}...\n"
        
        prompt = f"""Basándote en el análisis de todas las respuestas de estudiantes, crea una PAUTA DE CORRECCIÓN (rubric) para cada pregunta.

{context}

PREGUNTAS:
1. {PREGUNTAS[0]}
2. {PREGUNTAS[1]}
3. {PREGUNTAS[2]}

---

TAREA:
Crea una pauta de corrección que incluya:
1. Los elementos/conceptos clave que DEBEN aparecer (basado en lo más frecuente)
2. Puntos por cada elemento
3. Criterios de calidad

Responde en formato JSON:

{{
  "pregunta_1": {{
    "elementos_obligatorios": [
      {{"concepto": "nombre del concepto", "puntos": X, "descripcion": "qué debe incluir"}},
      ...
    ],
    "elementos_deseables": [
      {{"concepto": "nombre del concepto", "puntos": X, "descripcion": "qué debe incluir"}},
      ...
    ],
    "criterios_calidad": ["criterio 1", "criterio 2", ...],
    "puntaje_total": número,
    "ejemplo_respuesta_ideal": "Texto de una respuesta que cumpla todos los criterios"
  }},
  "pregunta_2": {{ ... }},
  "pregunta_3": {{ ... }},
  "notas_generales": "Observaciones sobre la pauta"
}}

Responde SOLO con JSON válido."""

        try:
            if client is None:
                print("❌ Error: Cliente OpenAI no configurado correctamente")
                return
                
            response = client.chat.completions.create(
                model=GPT_MODEL,
                messages=[
                    {"role": "system", "content": "Eres un profesor experto creando pautas de corrección para exámenes de finanzas."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )
            
            self.rubric = json.loads(response.choices[0].message.content)
            
            print("\n✅ Pauta de corrección generada")
            
            # Mostrar resumen
            for q_num in range(1, 4):
                q_key = f'pregunta_{q_num}'
                if q_key in self.rubric:
                    rubric_data = self.rubric[q_key]
                    print(f"\n{'='*80}")
                    print(f"📋 PAUTA PREGUNTA {q_num}")
                    print(f"{'='*80}")
                    print(f"Puntaje total: {rubric_data.get('puntaje_total', 'N/A')}")
                    print(f"\nElementos obligatorios:")
                    for elem in rubric_data.get('elementos_obligatorios', []):
                        print(f"  • {elem.get('concepto', 'N/A')} ({elem.get('puntos', 0)} pts): {elem.get('descripcion', '')}")
                    
                    if rubric_data.get('elementos_deseables'):
                        print(f"\nElementos deseables:")
                        for elem in rubric_data.get('elementos_deseables', []):
                            print(f"  • {elem.get('concepto', 'N/A')} ({elem.get('puntos', 0)} pts): {elem.get('descripcion', '')}")
            
        except Exception as e:
            print(f"❌ Error generando pauta: {e}")
    
    def export_reports(self):
        """Exporta todos los reportes"""
        print("\n" + "="*80)
        print("💾 EXPORTANDO REPORTES")
        print("="*80)
        
        # 1. Reporte de análisis de patrones
        pattern_report = []
        for q_key, pattern in self.pattern_analysis.items():
            pattern_report.append({
                'Pregunta': pattern['pregunta'][:50] + '...',
                'Total Respuestas': pattern['total_respuestas'],
                'Conceptos Más Frecuentes': ', '.join([f"{k} ({v}x)" for k, v in list(pattern['conceptos_frecuentes'].items())[:3]]),
                'Calidad Alta': pattern['distribucion_calidad'].get('alta', 0),
                'Calidad Media': pattern['distribucion_calidad'].get('media', 0),
                'Calidad Baja': pattern['distribucion_calidad'].get('baja', 0)
            })
        
        df_patterns = pd.DataFrame(pattern_report)
        df_patterns.to_excel('1_analisis_patrones.xlsx', index=False)
        print("✅ 1_analisis_patrones.xlsx")
        
        # 2. Análisis detallado por estudiante
        student_details = []
        for doc in self.extracted_answers:
            for q_num in range(1, 4):
                q_key = f'pregunta_{q_num}'
                if q_key in doc['answers'] and isinstance(doc['answers'][q_key], dict):
                    answer = doc['answers'][q_key]
                    
                    # Validar conceptos mencionados
                    conceptos = answer.get('conceptos_mencionados', [])
                    if not isinstance(conceptos, list):
                        conceptos = []
                    
                    # Validar puntos clave
                    key_points = answer.get('key_points', [])
                    if not isinstance(key_points, list):
                        key_points = []
                    
                    student_details.append({
                        'Estudiante': doc['student_name'],
                        'Pregunta': q_num,
                        'Conceptos Mencionados': ', '.join(conceptos),
                        'Num Puntos Clave': len(key_points),
                        'Longitud': answer.get('longitud_caracteres', 0),
                        'Calidad': answer.get('calidad_estimada', 'N/A')
                    })
        
        df_students = pd.DataFrame(student_details)
        df_students.to_excel('2_analisis_por_estudiante.xlsx', index=False)
        print("✅ 2_analisis_por_estudiante.xlsx")
        
        # 3. Pauta de corrección
        with open('3_pauta_correccion.json', 'w', encoding='utf-8') as f:
            json.dump(self.rubric, f, indent=2, ensure_ascii=False)
        print("✅ 3_pauta_correccion.json")
        
        # 4. Pauta en formato legible (Word-like en texto)
        with open('4_pauta_correccion.txt', 'w', encoding='utf-8') as f:
            f.write("="*80 + "\n")
            f.write("PAUTA DE CORRECCIÓN - EXAMEN DE FINANZAS\n")
            f.write("="*80 + "\n\n")
            
            for q_num in range(1, 4):
                q_key = f'pregunta_{q_num}'
                if q_key in self.rubric:
                    rubric_data = self.rubric[q_key]
                    f.write(f"\n{'='*80}\n")
                    f.write(f"PREGUNTA {q_num}\n")
                    f.write(f"{'='*80}\n")
                    f.write(f"{PREGUNTAS[q_num-1]}\n\n")
                    f.write(f"PUNTAJE TOTAL: {rubric_data.get('puntaje_total', 'N/A')} puntos\n\n")
                    
                    f.write("ELEMENTOS OBLIGATORIOS:\n")
                    for elem in rubric_data.get('elementos_obligatorios', []):
                        f.write(f"  [{elem.get('puntos', 0)} pts] {elem.get('concepto', 'N/A')}\n")
                        f.write(f"           {elem.get('descripcion', '')}\n\n")
                    
                    if rubric_data.get('elementos_deseables'):
                        f.write("\nELEMENTOS DESEABLES:\n")
                        for elem in rubric_data.get('elementos_deseables', []):
                            f.write(f"  [{elem.get('puntos', 0)} pts] {elem.get('concepto', 'N/A')}\n")
                            f.write(f"           {elem.get('descripcion', '')}\n\n")
                    
                    f.write(f"\nCRITERIOS DE CALIDAD:\n")
                    for criterio in rubric_data.get('criterios_calidad', []):
                        f.write(f"  • {criterio}\n")
                    
                    f.write(f"\nEJEMPLO DE RESPUESTA IDEAL:\n")
                    f.write(f"{rubric_data.get('ejemplo_respuesta_ideal', 'N/A')}\n")
                    f.write("\n")
            
            if 'notas_generales' in self.rubric:
                f.write(f"\n{'='*80}\n")
                f.write("NOTAS GENERALES\n")
                f.write(f"{'='*80}\n")
                f.write(f"{self.rubric['notas_generales']}\n")
        
        print("✅ 4_pauta_correccion.txt")
        
        print("\n✅ Todos los reportes exportados exitosamente")


def main():
    """Pipeline principal"""
    print("="*80)
    print("📚 PIPELINE DE ANÁLISIS ITERATIVO PARA CREAR PAUTA")
    print("="*80)
    print("\nEste pipeline realiza:")
    print("1️⃣  ITERACIÓN 1: Analiza documento por documento, acumulando patrones")
    print("2️⃣  ITERACIÓN 2: Genera pauta basada en las respuestas más frecuentes")
    print("="*80)
    
    # Configurar carpeta
    FOLDER_PATH = input("\nIngresa la ruta de la carpeta con los archivos Word: ").strip()
    
    if not os.path.exists(FOLDER_PATH):
        print(f"❌ Error: La carpeta '{FOLDER_PATH}' no existe")
        return
    
    # Verificar API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\n⚠️  No se encontró OPENAI_API_KEY")
        api_key = input("Ingresa tu API key de OpenAI: ").strip()
        os.environ["OPENAI_API_KEY"] = api_key
    
    # Ejecutar pipeline
    analyzer = AnswerPatternAnalyzer(FOLDER_PATH)
    
    # Validar estructura de carpetas
    if not analyzer.validate_folder_structure():
        print("❌ Error en la estructura de carpetas")
        return
    
    # Cargar documentos
    analyzer.load_documents()
    
    if len(analyzer.documents) == 0:
        print("❌ No se encontraron documentos válidos")
        return
    
    # ITERACIÓN 1: Análisis iterativo
    analyzer.analyze_patterns_iteratively()
    
    # Sintetizar patrones
    analyzer.synthesize_patterns()
    
    # ITERACIÓN 2: Generar pauta
    analyzer.generate_rubric()
    
    # Exportar reportes
    analyzer.export_reports()
    
    print("\n" + "="*80)
    print("✅ PIPELINE COMPLETADO")
    print("="*80)
    print("\nArchivos generados:")
    print("  📊 1_analisis_patrones.xlsx - Resumen de patrones por pregunta")
    print("  📋 2_analisis_por_estudiante.xlsx - Detalle por estudiante")
    print("  📄 3_pauta_correccion.json - Pauta en formato JSON")
    print("  📝 4_pauta_correccion.txt - Pauta en formato legible")
    print("\n💡 La pauta fue creada basándose en las respuestas más frecuentes")


if __name__ == "__main__":
    main()