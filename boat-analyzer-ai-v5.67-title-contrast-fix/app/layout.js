export const metadata={
 title:{default:'BOAT ANALYZER NEXUS',template:'%s | BOAT ANALYZER NEXUS'},
 description:'全国24場のBOAT RACE公式データをもとに、出走表・展示・今節成績・オッズをまとめて確認できるAIレース分析サービス。',
 applicationName:'BOAT ANALYZER NEXUS',
 robots:{index:true,follow:true},
 openGraph:{
  title:'BOAT ANALYZER NEXUS',
  description:'全国24場 × AIレース分析。公式データをまとめて直前分析。',
  type:'website',
  locale:'ja_JP',
  siteName:'BOAT ANALYZER NEXUS'
 },
 twitter:{card:'summary',title:'BOAT ANALYZER NEXUS',description:'全国24場 × AIレース分析'}
};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#071a33'};
export default function RootLayout({children}){return <html lang="ja"><body>{children}</body></html>}
