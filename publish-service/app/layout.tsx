import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'옵시온 Publish',description:'선택한 노트를 웹에서 읽는 옵시온 공유 페이지',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
